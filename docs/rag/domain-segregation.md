# Segregação de Domínios do RAG (OPERATIONAL vs SYSTEM)

Status do controle: implementado e fail-closed. Estado executável observado em
2026-08-14: **PASS** na stack local isolada, com PostgreSQL e rag-service reais
acessíveis, probes obrigatórios executados e todos os contadores bloqueantes em
zero (`reports/rag-domain-segregation-report.json`). Probe pulado continua não
contando como PASS; este resultado do controle RAG não implica, isoladamente,
GO agregado de release.

## 1. Os dois domínios

```
RAG
├── OPERATIONAL                     → conhecimento de negócio
│   ├── global permitido            → (classificação PRODUCTION, tenant da plataforma)
│   └── isolado por tenant          → conteúdo do próprio tenant
└── SYSTEM                          → conhecimento técnico
    ├── SUPPORT autorizado          → runbooks/diagnóstico para perfil auditor
    └── DEVELOPMENT                 → arquitetura, esquemas, QA, engenharia
```

- **OPERATIONAL**: atende usuários e clientes (produtos, serviços, agenda, FAQ, políticas do tenant). Usado pela IA operacional em produção.
- **SYSTEM**: desenvolvimento, diagnóstico, QA, troubleshooting. **Nunca** consultado nem exposto pela IA operacional.

Os dois domínios usam a mesma infraestrutura física (pgvector, tabela `rag_chunks`, modelo de embeddings). A segregação é **lógica e obrigatória**, comprovável no armazenamento, na recuperação, na autorização, no cache, nos testes e no CI/CD — não depende de convenção de nomes nem de instrução em prompt.

## 2. Decisão arquitetural: Estratégia B (armazenamento compartilhado + política obrigatória)

Adotada a estratégia B: uma única tabela `rag_chunks` com colunas obrigatórias `domain`, `classification` e `sensitivity`, filtradas **no SQL antes da busca vetorial**.

Justificativa:
- O isolamento por tenant já era provado no SQL (`WHERE tenant_key = %s`) com índice dedicado; estender o mesmo mecanismo para domínio/classificação mantém um único caminho de enforcement.
- pgvector suporta filtros `WHERE` com índice composto sem degradar recall.

Riscos residuais documentados:
- Um `UPDATE`/`DELETE` manual fora do pipeline pode violar a coerência; mitigado por `CHECK constraints` na migration `api/db/migrations/20260801000001-add-rag-domain-segregation.js`.
- Consultas SQL diretas ao banco (fora do serviço) não passam pelo Domain Router — o banco é caminho privilegiado, protegido por credenciais de infraestrutura, não por autorização de aplicação.

## 3. Metadados obrigatórios

Toda linha de `rag_documents` e `rag_chunks` possui:

| Coluna | Valores | Default (backfill) |
|---|---|---|
| `domain` | `OPERATIONAL`, `SYSTEM` | `OPERATIONAL` |
| `classification` | `PRODUCTION`, `SUPPORT`, `DEVELOPMENT` | `PRODUCTION` |
| `sensitivity` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED` | `INTERNAL` |

Coerência exigida (rejeitada na ingestão e por CHECK constraint):
- `OPERATIONAL` nunca aceita `DEVELOPMENT`;
- `SYSTEM` nunca aceita `PRODUCTION`.

Todo o conteúdo anterior à migration é operacional — o backfill via DEFAULT é correto (nenhum conteúdo SYSTEM era indexado).

Índices: `idx_rag_chunks_tenant_domain_classification` e `idx_rag_documents_tenant_domain_classification` em `(tenant_key, domain, classification)`.

## 4. Fluxo obrigatório de autorização (antes da recuperação)

```
Ator autenticado (req.agent)
→ classificação resolvida (experience-segregation: super_admin→DEVELOPMENT, auditor→SUPPORT, demais→PRODUCTION)
→ Domain Router (api/services/rag/domainRouter.js) resolve o escopo
→ ragService envia scope + X-RAG-Internal-Token ao rag-service
→ SQL: tenant + domínio + classificação + sensitivity + ACL de roles/agent
      + documento pai ativo/indexado
→ busca vetorial (somente dentro do escopo)
→ resposta (prompt do domínio correspondente)
→ auditoria (logRagAction + logs estruturados sem conteúdo sensível)
```

É proibido "buscar tudo e filtrar depois" — o filtro acontece no `WHERE`, antes do cálculo de similaridade (`vector_store.py:search`).

Roles e `agentId` vêm exclusivamente do ator autenticado no Node. Valores
forjados pelo payload são sobrescritos; sem ator, os arrays vazios tornam
elegíveis somente documentos sem restrição de identidade. O SQL também exige
`rag_documents.status = 'active'` e `index_status = 'indexed'`, impedindo uso de
chunks antigos durante alteração de ACL/domínio/conteúdo.

### Política de acesso (Domain Router)

| Ator | OPERATIONAL | SYSTEM |
|---|---|---|
| sem ator (fluxo interno) | PRODUCTION | negado |
| PRODUCTION | PRODUCTION | **negado** (`domain_not_allowed`) |
| SUPPORT (auditor) | PRODUCTION, SUPPORT | SUPPORT |
| DEVELOPMENT (super_admin) | PRODUCTION, SUPPORT | SUPPORT, DEVELOPMENT |

O domínio **nunca** é escolhido pelo texto da pergunta, por similaridade semântica nem por metadados enviados pelo cliente. `options.domain` no body só é honrado se a classificação do ator permitir; caso contrário a rota responde `403 domain_not_allowed`. Na dúvida, o escopo mais restritivo é aplicado.

## 5. Autenticação serviço-a-serviço

- O rag-service (FastAPI) exige o header `X-RAG-Internal-Token` em todas as rotas `/rag/*`, em qualquer ambiente (middleware em `rag-service/main.py`).
- O backend Node envia o token em todas as chamadas (`getRagInternalHeaders()` em `api/services/rag/ragRuntime.js`, aplicado em `ragService.js`, `nlpService.js`, `systemStatusService.js`, `ragDocumentsIndexing.js`).
- Sem `RAG_INTERNAL_TOKEN` forte (mínimo 32 bytes), o Python responde `503` e o cliente Node falha com `rag_internal_auth_misconfigured`; token curto/placeholder também é tratado como configuração ausente.
- Os composes de runtime injetam a mesma variável no Node e no Python; o compose de produção usa apenas `expose`, sem publicar a porta do RAG no host. O override local vincula eventual porta a `127.0.0.1`.
- `npm run system:bootstrap` gera `ENCRYPTION_KEY`, gera o token interno quando necessário e sincroniza o valor em `rag-service/.env`, sem exibir os segredos. Variáveis já exportadas por CI continuam tendo precedência nos comandos oficiais.
- `GET /rag/health` exige token interno; sem `tenant_id` e com token válido
  expõe estatísticas agregadas cross-tenant. Para health público restrito, use
  `GET /health`, que não expõe estatísticas cross-tenant.

## 6. Ingestão estrita

`POST /rag/index` (`rag-service/api/routes/index.py`):

1. Documento sem `domain` ou `classification` → **400** (`missing_domain` / `missing_classification`). Conteúdo não classificado nunca é indexado (não há quarentena: rejeição explícita).
2. Valores inválidos ou combinação incoerente → **400** (`invalid_domain`, `invalid_classification`, `incoherent_domain_classification`).
3. Detecção de secrets **antes** de chunking/embedding → **422** (`secret_detected`) com as categorias casadas (o valor do secret nunca é ecoado nem logado). Padrões em `rag-service/services/domain_policy.py` (private keys, AWS, OpenAI/Anthropic, Slack, GitHub, JWT, password/token assignments, Bearer, WhatsApp).

Pipelines de ingestão:
- **Operacional** (UI de documentos, web-scraping, chat upload, journey trainer): o servidor Node fixa `OPERATIONAL/PRODUCTION/INTERNAL` em `ragService.indexDocument` — o cliente nunca declara domínio.
- **Técnico** (SYSTEM): exige declaração explícita de um chamador autorizado (hoje: scripts de governança e o endpoint com token interno). Promoção SYSTEM → OPERATIONAL exige novo artefato (novo documento, revisão e classificação), nunca troca de metadado in-place.

CRUD no Node usa PostgreSQL como fonte autoritativa. Create/list/read/update/delete
e reindex falham com `PERSISTENCE_REQUIRED` (HTTP 503 no boundary) quando o DB
não está disponível; o Map é apenas cache leve. Update/delete/reindex exigem
`tenant_key` também na camada de serviço, e a rota pública não aceita PK de
documento escolhida pelo cliente. A substituição de chunks é transacional e
nenhum reindex completo apaga o corpus do tenant antecipadamente.

## 7. Proibição de fallback entre domínios

- Se a consulta não encontra resultado no domínio autorizado, a resposta é "Não encontrei informação operacional autorizada" (ou equivalente técnica no domínio SYSTEM). O serviço **nunca** busca no outro domínio automaticamente.
- O fallback de `minScore` dentro do rag-service mantém o **mesmo escopo** (testado).
- Prompts separados: o template operacional (existente, com proteção anti-prompt-injection) vale só para OPERATIONAL; o domínio SYSTEM usa template técnico fixo (`SYSTEM_DOMAIN_PROMPT_TEMPLATE` em `rag-service/api/routes/query.py`), não configurável por tenant.

## 8. Cache e memória

- Contexto efêmero Redis: chave `ctx:{tenantId}:{domain}:{executionId}` (`api/services/ephemeralRagContextService.js`) — sessões operacionais nunca reutilizam contexto do domínio SYSTEM e vice-versa.
- Existe cache de respostas com TTL curto; a chave inclui tenant, domínio,
  classificação, sensitivity efetiva, roles, agentId, opções e tenant context.
  Mutações/reindex invalidam todas as entradas do tenant.
- Troca de tenant não reutiliza contexto nem resposta por namespacing da chave.

## 9. Métricas e Release Gate

`npm run report:rag-domain-segregation` gera `reports/rag-domain-segregation-report.json` com:

- `crossDomainLeakage` — canário SYSTEM indexado e consultado com escopo OPERATIONAL (probe real, com cleanup);
- `crossTenantLeakage` — canário consultado por tenant intruso (probe real);
- `unclassifiedDocuments` / `incoherentDocuments` — varredura SQL das duas tabelas;
- `indexedSecrets` — varredura do conteúdo dos chunks com os padrões de secret;
- `operationalAccessToSystemDomain` — chamada sem token deve receber 401;
- `distribution` — contagem por domínio/classificação (cobertura separada por domínio).

O gerador exige conexão real ao banco, serviço alcançável e execução dos probes
obrigatórios. `serviceReachable=false`, consulta SQL não executada ou probes
`skipped` produzem `FAIL`, mesmo quando os contadores conhecidos são zero.

O Coverage Gate (`npm run validate:coverage-gate`) lê o relatório (re-executa se mais velho que 24h; skip com `COVERAGE_GATE_SKIP_RAG_RUN=1`) e aplica o threshold bloqueante `ragDomainSegregationViolations = 0` (`qa/coverage/gateThresholds.js`, `config/coverage-gate-thresholds.json`). Qualquer vazamento entre domínios ou tenants → `NO_GO`.

## 10. Testes

- `rag-service/tests/test_domain_segregation.py` + `test_vector_store_search_sql.py`: ingestão estrita, secrets, ACL/sensitivity/estado do pai no SQL, sem fallback entre domínios, isolamento de tenant e token interno.
- `tests/unit/ragDomainRouter.test.js`: política por classificação de ator e sanitização sem amplificação.
- `tests/unit/ragTenantScopeGuard.test.js`, `ragPersistenceRequired.test.js` e `ragDeleteAlsoRemovesFromVectorStore.test.js`: tenant obrigatório nas rotas/serviços, persistência fail-closed e delete seguro.
- `tests/unit/askAiRouteSecurity.test.js`: autenticação, permissão, rate limit, identidade e auditoria durável de `POST /api/ask-ai`.
- `tests/unit/coverage/coverageGate.test.js`: violação de segregação RAG bloqueia o gate.

Comandos:

```bash
cd rag-service && set -a && . ./.env && set +a && venv/bin/python -m pytest tests/ -q
npx jest tests/unit/ragDomainRouter.test.js tests/unit/ragTenantScopeGuard.test.js
npm run report:rag-domain-segregation
npm run validate:coverage-gate
```

## 11. Troubleshooting

- **401 em todas as chamadas Node → rag-service**: `RAG_INTERNAL_TOKEN` divergente entre `.env` (Node) e `rag-service/.env` (Python). O Python lê o env no boot; reinicie o uvicorn após mudar o token.
- **400 `missing_domain` ao indexar**: o chamador não passou por `ragService.indexDocument` (que fixa o default operacional). Indexações diretas ao serviço Python devem declarar domínio explicitamente.
- **Query operacional não retorna documento técnico**: comportamento esperado — conteúdo SYSTEM nunca aparece no domínio OPERATIONAL. Para uso técnico, ator SUPPORT/DEVELOPMENT com `options.domain: 'SYSTEM'`.
- **Health sem estatísticas**: sem token interno ou sem `tenant_id`, o health retorna apenas status (`scopeRestricted: true`).

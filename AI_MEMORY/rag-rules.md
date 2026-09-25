# RAG Rules

RAG is tenant-scoped governed knowledge. It includes documents, adaptive learning, chunk/vector state, question generation rules and RAG service integration.

## Canonical sources

- `docs/RAG_POR_TENANT.md`
- `docs/RAG_PARA_DEV.md`
- `docs/CONFIGURACAO_RAG_CENTRALIZADA.md`
- `docs/COMO_TESTAR_RAG.md`
- `docs/APRENDIZADO_ADAPTATIVO_RAG.md`
- `docs/TENANT_CONTEXT_RAG.md`
- `api/modules/rag-documents/routes.js`
- `frontend/src/pages/RAGDocumentsPage.impl.jsx`
- `rag/buildRagContext.js`
- `rag/ragPipelineAdapter.js`

## Runtime notes

Validação Playwright de 2026-08-14 na stack local isolada confirmou
`/rag-documents` autenticada, renderizada em HTTP 200, sem erros de console nem
falhas de rede (`reports/runtime-routes-validation-report.json`).

## Arquitetura de eficiência (2026-08-03)

- **Deduplicação no Postgres** (não mais Maps/dicts em memória): structural via `metadata->>'content_hash'`, semantic via hash exato + top-1 vetorial (`embedding <=> ::vector`, limiar 0.97) no HNSW; sobrevive a restart. Índices de expressão: migration `api/db/migrations/20260803000001-add-rag-chunks-dedup-indexes.js`. `registerChunk`/`register_chunk` são no-ops de compatibilidade — o JSONB `metadata` de `rag_chunks` é a fonte da verdade.
- **Dedup semântico desativado para `rpa-artifact` (2026-08-23)**: evidências operacionais de alta cardinalidade (execuções RPA, `source=rpa-artifact`) têm boilerplate similar entre execuções; o limiar 0.97 descartava execuções distintas (recordings com 0 cópias indexadas). Em `rag-service/api/routes/index.py`, `skip_semantic_dedup = (metadata.source == 'rpa-artifact')` — o dedup estrutural (`content_hash`, ETAPA 3) continua valendo para duplicatas exatas. Testes em `rag-service/tests/test_index.py` (`test_index_rpa_artifact_skips_semantic_dedup` / `test_index_non_rpa_artifact_still_deduped`).
- **Circuit breaker** no Node (`fetchRagWithBreaker` em `api/services/rag/ragRuntime.js`): 3 falhas → abre 30s, fail-fast `rag_unavailable`; retry com backoff só em GETs idempotentes. Config: `RAG_CB_*`.
- **Timeout de query dedicado**: 30s default (`RAG_QUERY_TIMEOUT` / `rag.queryTimeoutMs`, por tenant); demais chamadas 5s. Python desiste da OpenAI em 25s (client singleton em `llm_service.py`) — nunca pagar token de resposta abortada.
- **Caches**: tenant context (TTL 60s, `invalidateTenantContextCache` em writes de tenant_context), resposta RAG (TTL 10min, `api/services/rag/ragResponseCache.js`), embeddings de query no Python (LRU 1024), `config.json`/learning data por mtime, contrato RAG memoizado, `ragContextCache` com TTL 1h + cap 500.
- **Gating por intent**: `queryRag` pula `/rag/query` para saudação e despedida
  (incluindo agradecimentos/encerramentos), configurável por `RAG_SKIP_INTENTS`.
- **Token interno obrigatório em TODAS as chamadas** Node → rag-service (`getRagInternalHeaders()`), inclusive GETs (`/rag/health`, `/rag/documents`, `/rag/embeddings`).
- **Fail-closed de autenticação/persistência (2026-08-14)**: token interno ausente/curto bloqueia o cliente Node e todas as rotas `/rag/*` do Python; compose injeta a mesma credencial nos dois serviços e produção não publica a porta do RAG. CRUD documental exige PostgreSQL e retorna `PERSISTENCE_REQUIRED`/503 em vez de confirmar cache em memória.
- **Mutações por ID sempre tenant-scoped**: update/delete/reindex exigem o tenant também no serviço, consultam `id + tenant_key` e criação pública não aceita PK escolhida pelo cliente. Reindex substitui chunks transacionalmente, sem apagar antecipadamente o corpus inteiro.
- **ACL de retrieval fail-closed**: roles e agentId são derivados do ator autenticado, nunca de filtros do payload; SQL aplica roles, agents, sensitivity, status ativo e `index_status=indexed` antes da similaridade. Sem ator, apenas documentos sem restrição de identidade são elegíveis.
- **Perguntar à IA**: `POST /api/ask-ai` exige autenticação, tenant, `rag:query`, rate limit e auditoria PostgreSQL confirmada antes de consultar. A indisponibilidade do audit log responde 503.
- **Python**: handlers síncronos no threadpool (não `async def` bloqueante — 1 worker); warm-up do modelo no lifespan de `main.py` + pré-download no Dockerfile; índice vetorial **HNSW** (`rag_chunks_embedding_hnsw_idx`, migration `20260803000002`) com `hnsw.ef_search=40` por sessão (`RAG_HNSW_EF_SEARCH`, fallback `ivfflat.probes`); LLM default `gpt-4o-mini`.
- **Permissões no SQL**: `vector_store.search` filtra `permissions->'roles'`/`->'agents'` no SQL (jsonb `?|`/`?`); chunk sem restrição = visível a todos. Sem pós-filtro em Python.
- **Deps do rag-service** (2026-08-06): torch **2.9.1+cpu** (era 2.2.2), onnxruntime 1.28, optimum 2.1.0 + `optimum-onnx 0.1.0` (optimum 1.27 quebra com torch 2.9: import de `_attention_scale` removido), numpy 2.5.1, fastapi 0.141, sentence-transformers 5.6, openai 2.x. `transformers==4.57.6` + `huggingface-hub==0.36.2` SEGUEM pinados — transformers 5.x quebra o optimum (import de `is_tf_available` removido; `optimum-onnx` exige transformers<4.58). `settings.py` usa `SettingsConfigDict`.
- **Cache leve de documentos**: `ragDocumentsService` não carrega `content` no Map de startup; search via ILIKE no DB; content pontual via findByPk/hidratação.
- O cache de resposta inclui tenant, identidade/ACL e escopo de domínio; qualquer mutação documental invalida as entradas do tenant.

## Estado executável observado (2026-08-14)

`reports/rag-domain-segregation-report.json` está `PASS` na stack local
isolada: PostgreSQL e rag-service reais estavam acessíveis, os probes
obrigatórios foram executados e todos os contadores bloqueantes ficaram em
zero. Probe ignorado ou serviço inalcançável continua não contando como PASS;
este resultado do controle RAG não implica, isoladamente, GO agregado de
release.

- **Backend ONNX de embeddings** (`RAG_EMBEDDING_BACKEND`, default `torch` no código; compose de produção define `onnx`): `get_embedding_model()` em `embedding_service.py` carrega `SentenceTransformer(..., backend='onnx')` com fallback explícito para torch + warning. Pins atuais: `torch==2.9.1+cpu`, `optimum==2.1.0`, `optimum-onnx==0.1.0`, `onnxruntime==1.28.0` e `transformers==4.57.6`. O `rag-service/Dockerfile` pré-baixa os pesos torch e a variante ONNX (`onnx/model.onnx`).

- **Restart do rag-service dev exige env do `.env`** (2026-08-07): sem
  `DATABASE_URL`, `/health` pode responder `healthy` com `dbConfigured: false`,
  mas readiness/report falham e `/rag/index` não confirma persistência
  (`success: false`, `chunksCreated: 0`, erro `persistence_required`). Restart
  correto: `set -a; source .env; set +a; ./venv/bin/uvicorn main:app --reload --port 8001`.
  Verifique depois que `curl localhost:8001/health` reporte
  `dbConfigured: true`.

- **Execuções de QA/mesh exigem rag-service estável — o circuit breaker transforma
  indisponibilidade em falha de cenário** (2026-09-25). O breaker vive em
  `api/services/rag/ragRuntime.js` (`RAG_CB_FAILURE_THRESHOLD`, `RAG_CB_RESET_MS`,
  `RAG_CB_RETRY_BASE_MS`): após falhas consecutivas ele abre e passa a devolver
  `RAG_INDEX_FAILED::Serviço RAG indisponível no momento (circuit breaker aberto)`. O serviço
  em modo dev roda com `--reload`, que reinicia o worker e o deixa indisponível por alguns
  segundos. Medido no mesh: o cenário `CORE-BIZ-RAG-SEGREGATION` falhava exatamente por isso —
  **não** por deduplicação nem latência (quatro hipóteses foram refutadas por medição antes de
  instrumentar o cenário e ler o estado real do documento). Consequências práticas:
  (a) cenários que dependem de IA/RAG devem declarar dependência indisponível
  (`environment_missing`), nunca `failed` — `qa-mesh/meshRunner.js` reconhece `ai_unavailable`,
  `circuit breaker` e "serviço RAG indisponível"; (b) execuções de QA devem rodar o rag-service
  **sem `--reload`**; (c) mensagem de falha deve carregar o estado final do documento
  (`indexStatus`/`chunks`/`indexed`/erro), porque o `cleanup` do cenário apaga a evidência.


## Retrieval retrieve-only e ACL do corpus (medido 2026-09-25)

O gap "enriquecimento sem conteúdo" tinha **três causas independentes**, todas medidas contra o
serviço vivo:

1. **Retrieval era refém da geração.** Só existia `POST /rag/query` (busca + LLM). Com ~5954
   chunks indexados, o enriquecimento recebia `VECTOR_RAG_UNAVAILABLE` porque o breaker abria por
   falha de GERAÇÃO. Corrigido com `POST /rag/search` (retrieve-only) + `searchChunks()` no Node.
2. **ACL — a que realmente zerava.** Os 5954 chunks SYSTEM têm `permissions.roles=['super_admin']`.
   A busca ia com `roles: []` e a cláusula `permissions->'roles' ?| ARRAY[]` excluía TODOS.
   Com o role correto: `chunksFound 0 → 5`. A ACL **não** é contornada: o role de serviço é
   configurado em `ENGINEERING_KNOWLEDGE_ROLES`, e sem ele o estado é 0 itens +
   `KNOWLEDGE_ACL_NO_ROLES` (fail-closed, visível).
3. **Limites liam de um array.** `createResolvedScope` define `collections` como LISTA, mas o
   consumidor lia `collections?.maxResults`/`.minScore` — sempre `undefined`. Logo o `minScore` do
   budget nunca era aplicável e o serviço usava o default (0.5), descartando o corpus de
   engenharia (scores típicos 0.28–0.35). Agora os limites vivem em `scope.limits`.

**Lição permanente:** dois dos defeitos acima passaram por testes com *fakes* que tinham
exatamente a forma que eu supunha. Só o dado real revelou. Todo serializer/leitor de contrato
precisa de teste contra a ESTRUTURA REAL do produtor.

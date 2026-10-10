# Ask AI — Copiloto Operacional

Camada de assistência do RAP ("Perguntar à IA"), presente em todas as telas como
widget flutuante (`frontend/src/components/AskAiWidget.jsx`).

## Fluxo

```
Pergunta
  ↓
Contrato de contexto (api/services/askAi/contextContract.js)
  + Conversa persistida (api/services/askAi/conversationStore.js)
  + Roteador de intenção (api/services/askAi/intentRouter.js)
  + Contexto de entidade revalidado no backend
  + Data tools registradas (api/services/askAi/toolRegistry.js + toolAuthorization.js)
  + Conhecimento OPERATIONAL (RAG global ∪ tenant)
  ↓
Orquestrador (api/services/askAi/orchestrator.js)
  ↓
Resposta fundamentada + fontes + provenance + confidence
```

Rota: `POST /api/ask-ai` (`api/modules/platform-content/handleAskAiRoute.js`).
Guardas preservadas: autenticação, permissão `rag:query`, rate limit, auditoria
obrigatória fail-closed (503 `persistence_required`).

## Multi-turno

- `conversationId` identifica a conversa; o backend devolve e o widget reenvia.
- Estado persistido em `ask_ai_conversations` (tenant + usuário), sem fallback
  em memória. Migration: `api/db/migrations/20260911000001-create-ask-ai-conversations.js`.
- Janela limitada (`MAX_HISTORY_MESSAGES`, `MAX_HISTORY_CHARS`) com sumário
  determinístico do excedente; retenção `ASK_AI_CONVERSATION_RETENTION_DAYS`
  (default 30).
- Histórico enviado pelo cliente **nunca** é autoridade.

## Contexto de tela

Contrato fechado: `{ route, module, pageType, actionContext?, entityType?, entityId?, workspaceEntityId? }`.
Nunca DOM, HTML ou campos sensíveis. Campo desconhecido → 400.
`entityId` **não é autoridade**: a posse é revalidada no backend a cada turno
(`validateEntityContext`); entidade de outro tenant é indistinguível de
inexistente e nada é consultado.

## Ferramentas operacionais (read-only)

- Registro explícito; o LLM nunca gera SQL nem escolhe consulta.
- Cada tool declara `{resource, action}` do RBAC e é autorizada com a identidade
  real do usuário (`hasPermission`). Sem capacidade → resposta "você não possui
  acesso a ..." e nenhum valor derivado é exposto.
- Falha de tool → resposta parcial declarada ("Com os dados disponíveis…"),
  nunca dado inventado.
- Orçamento: `ASK_AI_MAX_TOOL_CALLS` (default 4), `ASK_AI_MAX_RAG_QUERIES` (default 1).

## Conhecimento e escopo

Escopo de recuperação derivado no servidor: `OPERATIONAL → [tenant atual, chave global]`,
`SYSTEM → [tenant atual]`. A chave global é `RAG_GLOBAL_OPERATIONAL_TENANT`
(default `system`, onde `scripts/rag-sync.js` indexa o conhecimento operacional
global). Payload do chamador **não** amplia escopo. Domínio SYSTEM nunca recebe
chave global e nunca é acessível a ator PRODUCTION.

## Segurança

- Prompt/data injection: conteúdo recuperado é DADO, neutralizado linha a linha
  e envelopado (`injectionGuard.js`).
- PII minimizada (CPF, e-mail, telefone, credenciais) antes do prompt.
- Internals técnicos (QA Waves, replay, seeds, coverage) bloqueados para PRODUCTION.

## Gate

`npm run validate:ask-ai-copilot` → `reports/ask-ai-copilot-report.json`
(22 invariantes; integrado ao `validate:governance-enforcement`). Além das 16
invariantes originais (rota, contrato, posse, tools, injeção, escopo RAG,
replay, manual, projeção, conversa, síntese, fonte única de tools), o gate
executa turnos reais do orquestrador (com store conversacional stub, offline)
para provar:

- `privacy_probe_classification` — "você tem acesso aos meus dados?" é
  `ASSISTANT_PRIVACY` (respondida por configuração, nunca RAG); a resposta
  declara acesso escopado (tenant + permissão + necessidade), nunca irrestrito;
- `screen_context_no_internals` — `SCREEN_CONTEXT` responde o rótulo humano da
  tela e nunca expõe rota, UUID, id de entidade ou tenant;
- `source_followup_exactness` — "qual foi a fonte?" devolve EXATAMENTE as
  fontes persistidas do turno anterior (sem re-RAG); conversa nova não atribui
  fonte alheia;
- `prior_provenance_grounded` — "por que você respondeu isso?" explica com as
  evidências usadas, sem prompt de sistema, CoT ou mecânica de tool;
- `provenance_payload_sanitized` — `provenance.liveData`/`knowledge` e
  `policy.deniedTools` carregam rótulos humanos; nenhum toolId/documentId/
  chunkId/"Chunk N" no payload fora das URLs de fonte (canal sancionado);
- `source_dto_title_dedup` — DTO de fonte é `{ title, url, sourceType, label }`
  com dedup por url; link `LIVE_DATA` gated por permissão e fail-closed.

## Comportamentos adicionados (2026-09-15)

- **Sonda de privacidade** (T-A1): o artigo flexível em "acesso aos meus dados"
  classifica `ASSISTANT_PRIVACY`; "acesso a outros clientes?" permanece
  `ASSISTANT_LIMITATIONS`.
- **Proveniência sanitizada** (T-A2): `buildProvenance` no orquestrador projeta
  rótulos; ids completos ficam no servidor/auditoria. Títulos de fonte com
  marcadores internos (`toolId=`, `chunkId=`, `askai.`) são tratados como
  técnicos e substituídos pelo rótulo derivado do documento.
- **Capacidades em contexto** (T-A3): o turno `ASSISTANT_CAPABILITIES` lê as
  capabilities do tenant (`tenantCapabilitiesService`, injetável via
  `deps.getTenantCapabilities`) e aplica `scopeToolsByTenantCapabilities` —
  tool que declara `tenantCapability` só é anunciada com a capability ligada
  (ausente/desconhecida não esconde; o RBAC já governa). Nenhuma tool do
  catálogo atual declara `tenantCapability`: o schema de capabilities do tenant
  (`inbox`/`caseManagement`) não cobre a vertical fitness — gatear fitness por
  capability de tenant exigiria decisão de schema fora do escopo. Com contexto
  de tela, a resposta é recortada ("Aqui, em <rótulo humano>, ...") sem expor
  rota/ids. A projeção de rótulos não tem mais fallback para id de tool.
- **Links operacionais** (T-A4): `askAi/operationalLinks.js` emite
  `{ sourceType: 'LIVE_DATA', label, url }` para rota real do frontend
  (FITNESS_STUDENT→`/fitness/students`, CONVERSATION→`/inbox?conversationId=`,
  ORDER→`/orders`, BOOKING→`/agenda`) apenas quando a posse foi revalidada, o
  ator mantém a permissão da rota e alguma tool devolveu dado. Tipo sem
  mapeamento (CUSTOMER/CASE/TICKET/CAMPAIGN) não gera link.
- **DTO de fonte** (T-A5): `buildSources` emite `title` humano e deduplica por
  `url` no backend (vários chunks do mesmo documento viram uma fonte).
- **Proveniência do turno** (T-A6): turnos assistentes persistidos ganham
  `answerId` determinístico (`ans_<sha256(conversa:turno)[:16]>`) e
  `toolCalls[]` (rótulo + status `ok`/`failed`/`denied`, nunca id);
  `buildPromptHistory` continua projetando apenas role/content/intent.
Projeções operacionais de jornada: `npm run journey:projections` +
`npm run validate:journey-projections`
(`reports/business-journey-projections.json`).

Validação local realizada em 2026-09-11: `npm run db:migrate` aplicou a
migration de conversa; `rag-service` passou `108 passed, 6 skipped`; Jest
unitário passou `668 suites / 4502 testes`; Vitest do contexto frontend passou.
Verificação HTTP real passou `9/9` com `npm run verify:ask-ai-copilot:runtime`
(evidência em `reports/ask-ai-copilot-runtime-evidence.json`): login,
multi-turno, contexto arbitrário, conversa inexistente, entidade inacessível,
ausência de token e superfície de replay.

## Corpus operacional global (drift encontrado e corrigido)

O `reports/rag-sync-manifest.json` declarava os roteiros canônicos
(`docs/roteiros/jornada-*`) como sincronizados em 2026-08-14, mas o banco do
ambiente **não tinha nenhum deles** — o copiloto respondia fallback para
"Como faço uma matrícula?".

Correção executada pelo caminho oficial (apontando `RAG_BASE_URL` para o serviço
local do ambiente):

```
RAG_BASE_URL=http://127.0.0.1:8001 npm run rag:sync:all
```

Resultado: `451/453` documentos indexados; as 2 falhas foram bloqueios
`secret_detected` (fail-closed) em `docs/governance/_platform-status-source.json`
e `docs/runbooks/05-integridade-replay.md`. Os roteiros passaram a existir como
`OPERATIONAL/PRODUCTION` no tenant `system`.

`scripts/rag-sync.js` também ingere explicitamente
`reports/business-journey-projections.json` (projeção operacional de jornadas)
via `EXTRA_OPERATIONAL_SOURCES`, verificado pelo gate
`journey_projection_sanitized`.

Consequência operacional: **o manifesto de sync não é prova de ingestão**.
Antes de afirmar que o conhecimento operacional está disponível, valide no banco
(`rag_documents` por `id`/`title` + `domain`/`classification`), não no manifesto.

## Geração degradada e provider do RAG (2026-10-08)

Defeito medido em browser real: com a credencial `openai` do tenant sem crédito
(HTTP 429 `credit_balance_exhausted`, 15 erros no dia), o `rag-service` engolia a
exceção e devolvia `"Com base nas informações disponíveis: <chunk[:300]>... Há N
fontes de informação relacionadas disponíveis."`. O widget exibia isso como
resposta normal e a API respondia `confidence: "fully_grounded"`, `intent:
"PROCEDURE"`, `facts: []` — perguntar "Como faço uma matrícula?" devolvia um
trecho sobre o modal de detalhe de replay. Os gates não pegavam: o
`validate:ask-ai-copilot` roda com store/LLM stub offline e o
`verify:ask-ai-copilot:runtime` validava apenas status/intent/confidence.

Contrato agora em vigor (não reverter):

- `ragService.queryRag` resolve o LLM pelo **roteamento do tenant**
  (`tenant_ai_settings.primary` → `secondary`, com `openai` como último recurso),
  restrito a providers OpenAI-compatible (`ai_providers.kind` ∈
  `openai-sdk` | `openai-compatible`); `anthropic` é pulado (protocolo próprio,
  o rag-service usa o SDK da OpenAI). Headers internos:
  `X-RAG-LLM-API-Key`, `X-RAG-LLM-Base-URL`, `X-RAG-LLM-Model`,
  `X-RAG-LLM-Provider` (a chave nunca é logada).
- `POST /rag/query` devolve `metadata.generated` e
  `metadata.degradationReason` (`llm_unavailable`, `llm_empty_response`,
  `no_relevant_chunks`, `invalid_query`, `internal_error`). Sem síntese, o texto
  se declara como **trecho recuperado**, nunca como resposta pronta.
- Ask AI: `metadata.generated === false` ⇒ `confidence: source_only` (com fatos
  vivos no turno: `partially_grounded`) — nunca `fully_grounded`.
- Resposta degradada **não** entra no cache de RAG (`metadata.generated !== false`).
- `resolveTenantLlmHeaders` exige conexão Sequelize (no runtime da API ela é
  aberta no boot; sem conexão o caminho avisa em `warn` e devolve degradação).

Regressões: `rag-service/tests/test_query_generation_degradation.py`,
`tests/unit/ragTenantLlmResolver.test.js`,
`tests/unit/askAiDegradedGeneration.test.js`.

Achado aberto (não corrigido): o corpus `system`/OPERATIONAL contém chunk
placeholder ("sem texto extraído. indexando metadados do arquivo.") de um `.jpeg`
cuja extração falhou; ele pontua ~0,55 e pode entrar nas fontes. A correção
pertence à indexação (não indexar documento sem texto extraído), não ao retrieval.

Camada de evidência e UI (mesma data):

- `verify:ask-ai-copilot:runtime` ganhou `first_turn_answer_generated`: a resposta
  do turno precisa ser **sintetizada** (sem marcador de degradação, sem
  `confidence: source_only`, com tamanho mínimo). A regra é a função pura
  `evaluateSynthesizedAnswer`, exportada para teste não-vácuo em
  `tests/unit/askAiRuntimeEvidenceGate.test.js` — antes o script só olhava
  status/intent/confidence e dava PASS com o copiloto degradado. Evidência
  regerada (10/10).
- Widget: o painel flutuante saiu de `left-6` para `left-4 sm:left-20`. A trilha
  primária ocupa 0–72px e o painel em 24px cobria os 8 itens do menu — o clique no
  menu era interceptado pelo painel (medido em 1194×603; clique em `/crm`
  bloqueado). Depois: zero item coberto e clique funcionando; em 390×720 o painel
  permanece dentro da viewport.



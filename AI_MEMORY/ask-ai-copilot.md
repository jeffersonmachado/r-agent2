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
(11 invariantes; integrado ao `validate:governance-enforcement`).
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

# RAP Cognitive Core — Arquitetura

Data: 2026-06-12

## Decisão arquitetural

- **Cognitive Core = núcleo obrigatório do RAP.** Todo fluxo inteligente passa por ele.
- **Agentes = camada opcional/adicional** (Agent OS, ver `src/core/agents/README.md`). O RAP não é uma arquitetura multiagente clássica.
- **Workspace continua sendo o centro da experiência.** Usuários operacionais enxergam apenas resultados de negócio.

## Localização

```
src/core/cognitive/
  context-engine/          monta contexto operacional (tenant, cliente, conversa, CRM, agenda, tickets, campanhas, métricas)
  intent-engine/           classificação de intenção (IA-first via LLM; handoff humano como degradação segura)
  action-planner/          intent → plano determinístico com permissões/confirmação
  tool-registry/           registro único de tools de negócio (nenhuma execução direta)
  execution-engine/        executa planos via Tool Registry, rollback, sanitização
  validation-engine/       valida pós-execução (interno; nunca exposto à operação)
  learning-engine/         registra execuções (event ledger + RAP Learn); não altera regras
  cognitive-orchestrator/  pipeline obrigatório + registro estruturado
  visibility.js            política PRODUCTION/SUPPORT/DEVELOPMENT
  sanitize.js              sanitização de payloads (segredos, profundidade, tamanho)
  index.js                 fachada do núcleo
```

## Pipeline obrigatório

```
INPUT
 ↓
CONTEXT ENGINE      (isolado por tenant, cache 30s por tenant, trace por fonte)
 ↓
INTENT ENGINE       ({ intent, confidence, entities, source, rationale })
 ↓
ACTION PLANNER      (plano determinístico; ações críticas exigem confirmação)
 ↓
EXECUTION ENGINE    (somente via Tool Registry; para em erro crítico; rollback)
 ↓
VALIDATION ENGINE   (interno; consistência, linkage, auditoria)
 ↓
LEARNING ENGINE     (event ledger cognitive.execution.* + RAP Learn em falhas)
```

API principal:

```js
const { getCognitiveOrchestrator } = require('src/core/cognitive');

const result = await getCognitiveOrchestrator().process({
  tenantId, channel, userId, message, eventType, payload,
});
```

Retorno operacional (apenas negócio): `{ executionId, tenantId, status, intent, confidence, humanHandoff, fallback, requiresConfirmation, outputs, latencyMs }`. Nunca expõe engines internas, plano técnico, trace de contexto, QA, replay, seeds, mesh ou RPA.

## Decisões de comportamento

| Situação | Comportamento |
|---|---|
| Classificação de intenção | **IA-first** (LLM via `aiProviderService`), com prompt que prioriza atendimento ao cliente e cobertura das necessidades de negócio. A classificação heurística por keywords/regex foi removida (2026-07-22) — inferência de intenção é responsabilidade exclusiva da IA |
| Falha/indisponibilidade do LLM na classificação | Handoff humano explícito com `source: 'ai_unavailable'` + log de erro — nunca classifica por heurística |
| Confiança < 0.55 ou intent fora da taxonomia | Fallback seguro → `transferir_humano`. Com `ticketId`/`conversationId`: executa `transferConversation`. Sem referência: `human_handoff_requested` sem executar tools |
| Passo crítico (`cancelar_agendamento`, `enviar_proposta`, `iniciar_campanha`) sem `payload.confirmed === true` | `halted_awaiting_confirmation` — nada crítico executa |
| Erro em passo obrigatório | `failed` + rollback best-effort dos passos já executados (quando a tool suporta) + registro em RAP Learn |
| Erro em passo opcional | Loga e continua |
| Falha de persistência de aprendizado | Best-effort: loga e não derruba o fluxo de negócio |
| Tenant divergente entre plano/contexto | Erro explícito `cognitive_execution_tenant_mismatch` |

## Reuso (nada de domínio foi duplicado)

| Camada do núcleo | Serviço existente reutilizado |
|---|---|
| Intent Engine (LLM) | `api/services/aiProviderService.generateAiResponse` |
| Context Engine | `marketingService`, `scheduleService`, `queueService`, `ccCampaignsService`, `channelConversationService` |
| Tool Registry | ver `docs/cognitive-core/tool-registry.md` |
| Learning Engine | `api/services/eventLedgerService.appendEventV1` + `api/modules/rap-learn/service.recordFailure` |
| Visibility | mesma política de `api/modules/agent-os/experience-segregation.js` |
| Workspace | `WorkspaceInsightService.persistInsight` (tool `generateInsight`) |

## Registro estruturado de execução (Etapa 7)

Cada execução emite (log estruturado + event ledger `cognitive.execution.completed|failed`):

```
executionId, tenantId, channel, userId, eventType,
intent, confidence, intentSource, intentRationale,
plan { planId, intent, steps, requiresConfirmation, denied },
toolsExecuted, result { status, failure, haltReason },
validation { valid, failedChecks }, contextTrace,
latencyMs, fallback, humanHandoff, createdAt
```

Tudo sanitizado (`sanitize.js`): chaves sensíveis (`token|password|senha|secret|authorization|api_key|credential|cookie|bearer`) viram `[redacted]`; strings truncadas em 500 chars; profundidade máxima 6.

## Integração com camadas existentes

- **Ponto de entrada natural**: `api/services/messageProcessor.js` (inbound omnichannel) e rotas de automação podem chamar `getCognitiveOrchestrator().process(...)`. A integração no messageProcessor não foi feita nesta entrega (sprint de finalização — mudança no pipeline de mensagens em produção exige validação browser/E2E própria); o núcleo é consumível imediatamente por qualquer serviço backend.
- **Agent OS**: agentes corporativos podem usar o mesmo Tool Registry; o orchestrator HTTP do Agent OS (`/api/agent-orchestrator/execute`) permanece como camada opcional.
- **QA Waves**: validam o Cognitive Core por fora (testes em `tests/unit/cognitiveCore*.test.js`); o núcleo nunca expõe QA/Replay/Seeds/Mesh/RPA à operação.

## Testes

- `tests/unit/cognitiveCoreIntentEngine.test.js` — taxonomia, determinismo, entities, LLM, fallback
- `tests/unit/cognitiveCoreToolRegistry.test.js` — contrato, tenant, permissão, visibility, ocultação, delegação real
- `tests/unit/cognitiveCorePipeline.test.js` — planner, execution, validation, learning, orchestrator E2E, multi-tenant, segregação

Rodar: `npx jest tests/unit/cognitiveCore` (incluído em `npm run test:unit`).

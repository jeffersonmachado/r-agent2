# Cognitive Core — Gap Analysis

Data: 2026-06-12
Base: `docs/cognitive-core/current-state.md`

Classificação: **EXISTS** (reutilizar como está) · **PARTIAL** (consolidar/evoluir) · **MISSING** (implementar)

Regra aplicada: somente componentes PARTIAL e MISSING foram implementados/consolidados. Componentes EXISTS são consumidos sem duplicação.

| # | Componente | Status | Evidência | Ação tomada |
|---|---|---|---|---|
| 1 | Provider de IA multi-tenant | **EXISTS** | `api/services/aiProviderService.js` | Reutilizado pelo Intent Engine (camada LLM opcional) |
| 2 | RAG / contexto documental | **EXISTS** | `rag-service/`, `api/services/contextSourceResolver.js` | Reutilizado pelo Context Engine (fonte `knowledge`) |
| 3 | NLP utilitário | **EXISTS** | `api/services/nlpService.js` (`normalizeText`) | Disponível para normalização de texto; o Intent Engine não usa mais regras determinísticas (classificação 100% via LLM) |
| 4 | **Context Engine operacional** (tenant, customer, conversa, CRM, agenda, tickets, campanhas, métricas) | **MISSING** | Nenhum agregador de contexto operacional existe | Implementado em `src/core/cognitive/context-engine/` delegando a serviços existentes |
| 5 | **Intent Engine** (classificação de texto com confidence, entities, fallback, justificativa) | **MISSING** | agent-orchestrator recebe intent pronto; sem classificador | Implementado em `src/core/cognitive/intent-engine/` (IA-first via LLM; handoff humano em baixa confiança ou falha de IA; regras determinísticas por keywords removidas em 2026-07-22) |
| 6 | **Action Planner** (intent → plano com permissões, tenant, confirmação) | **MISSING** | Só capabilityIntentMap estático sem validação | Implementado em `src/core/cognitive/action-planner/` (planos determinísticos por intent) |
| 7 | **Tool Registry** (interface CognitiveTool com visibility/permissions) | **PARTIAL** | `CAPABILITY_REGISTRY` em `agent-orchestrator.js` tem category mas faz require de serviços inexistentes com fallback silencioso | Consolidado em `src/core/cognitive/tool-registry/` com 13 tools reais sobre serviços existentes; validação de tenant, permissão e visibility obrigatória |
| 8 | **Execution Engine** (execução de plano, parada em erro crítico, rollback, sanitização) | **PARTIAL** | Loop de execução existe no agent-orchestrator, mas sem plano, rollback, sanitização ou parada em erro crítico | Implementado em `src/core/cognitive/execution-engine/` |
| 9 | **Validation Engine** (pós-execução: estado esperado, consistência, auditoria) | **MISSING** | Validation engine existente é de QA (`qa/`), não de execução cognitiva | Implementado em `src/core/cognitive/validation-engine/` (QA Waves continuam validando o núcleo externamente, nunca expostas à operação) |
| 10 | **Learning Engine** (registro de execução: sucesso, falha, latência, fallback, handoff) | **PARTIAL** | `api/modules/rap-learn/service.js` cobre só pipeline de falhas | Implementado em `src/core/cognitive/learning-engine/` gravando `LearningRecord` (reuso do modelo) + event ledger; não altera regras críticas automaticamente |
| 11 | **Cognitive Orchestrator** (pipeline obrigatório INPUT→CONTEXT→INTENT→PLAN→EXECUTE→VALIDATE→LEARN) | **MISSING** | agent-orchestrator não tem pipeline cognitivo | Implementado em `src/core/cognitive/cognitive-orchestrator/` com API `process({...})` |
| 12 | Visibility Policy PRODUCTION/SUPPORT/DEVELOPMENT | **EXISTS** | `api/modules/agent-os/experience-segregation.js` | Reutilizada como fonte da política; Tool Registry aplica a mesma classificação |
| 13 | Logs estruturados / auditoria | **PARTIAL** | logger + ai-governance + event ledger existem; faltava o registro de execução cognitiva com campos mínimos | Execution record estruturado (executionId, tenantId, channel, intent, confidence, plan, toolsExecuted, result, latencyMs, fallback, humanHandoff, createdAt) emitido pelo orchestrator |
| 14 | Multi-tenant isolation | **EXISTS** | `tenant_id` em todos os modelos, stores por tenant | Validação de tenant em todas as camadas do núcleo |
| 15 | Workspace como centro da experiência | **EXISTS** | `api/services/workspace/*`, frontend workspace | Tool `generateInsight` persiste insight; nada técnico exposto |
| 16 | Agentes (camada opcional) | **EXISTS** | Agent OS (`api/modules/agent-os/` e afins) | Documentados como camada opcional em `src/core/agents/README.md`; não substituem o núcleo |
| 17 | QA Waves / Mesh / Replay / Seeds / RPA ocultos da operação | **EXISTS** | `PRODUCTION_HIDDEN_ROUTES` em experience-segregation | Reforçado: Tool Registry não registra nenhuma tool DEVELOPMENT visível para operação; testes garantem ocultação |
| 18 | Event bus canônico | **EXISTS** | `api/services/eventLedgerService.js` (`appendEventV1`) | Reutilizado para eventos `cognitive.execution.*` |

## Tools mapeadas (serviço real reutilizado)

| Tool | Serviço existente | Status do alvo |
|---|---|---|
| searchCustomer | `marketingService.listLeads` / `entityProfileService.buildEntityProfile` | EXISTS |
| createLead | `marketingService.upsertLead` | EXISTS |
| updateLead | `marketingService.updateLead` | EXISTS |
| createOpportunity | módulo CRM (`api/modules/crm/routes.js`) | PARTIAL — sem service layer; tool delega ao store CRM |
| createAppointment | `scheduleService.createSchedule` | EXISTS |
| rescheduleAppointment | `scheduleService.updateScheduleStatus(action: reschedule)` | EXISTS |
| cancelAppointment | `scheduleService.updateScheduleStatus(action: cancel)` | EXISTS |
| sendWhatsappMessage | `whatsappService.sendTextMessage` | EXISTS |
| createTicket | `queueService.createTicket` | EXISTS |
| transferConversation | `handoverService.takeOver` | EXISTS |
| originateCall | `ccClick2CallService.createClick2CallRequest` | EXISTS |
| createCampaign | `ccCampaignsService.upsertCampaign` | EXISTS |
| generateInsight | `WorkspaceInsightService.persistInsight` | EXISTS |

## Itens explicitamente fora de escopo (premissas)

- Agentes CRM/Agenda/PBX/Campanhas como módulos principais — **não criados** (Agent OS permanece opcional).
- Exposição de QA Waves, Replay, Seeds, RPA, Mesh para operação — **proibida e testada**.
- Duplicação de serviços de domínio — **nenhum serviço de domínio foi reescrito**.

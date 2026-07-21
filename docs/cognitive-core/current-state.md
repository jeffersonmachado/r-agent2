# Cognitive Core — Current State (Auditoria do Repositório)

Data da auditoria: 2026-06-12
Escopo: levantamento integral do que já existe no RAP relacionado a IA, RAG, NLP, intents, workflows, automações, CRM, agenda, inbox, PBX, campanhas, analytics, QA Waves, replay, RPA, seeds, mesh, event bus, logs, multi-tenant e workspace.

Decisão arquitetural confirmada: **Cognitive Core = núcleo obrigatório do RAP; agentes = camada opcional**. O RAP não é uma arquitetura multiagente clássica.

---

## 1. IA / LLM

| Item | Detalhe |
|---|---|
| Localização | `api/services/aiProviderService.js`, `api/services/aiSuggestionService.js`, `api/services/aiFlowGenerator.js`, `api/services/aiWrappersAdapter.js` |
| Responsabilidade | Abstração de providers de IA por tenant (`generateAiResponse(prompt, tenantId, context)`), sugestões, geração de fluxos |
| Maturidade | Alta — em produção, com hidratação de config por tenant (`TenantAICredential`, `TenantAISetting`) |
| APIs expostas | Interno (service layer); rotas em `api/modules/intelligence/` |
| Eventos | Logs estruturados via `api/utils/logger` |
| Reaproveitamento | **Total** — Intent Engine usa `generateAiResponse` como camada LLM opcional |
| Gaps | Nenhum para o Cognitive Core |

## 2. RAG

| Item | Detalhe |
|---|---|
| Localização | `rag/`, `rag-service/` (Python/FastAPI), `api/services/ragContextBuilder.js`, `api/services/ephemeralRagContextService.js`, `api/services/contextSourceResolver.js`, `api/modules/rag-documents/` |
| Responsabilidade | Contexto persistido (RAG) e efêmero (Redis), resolução inline → Redis → RAG |
| Maturidade | Alta |
| APIs expostas | `/rag/*` (serviço Python na porta 8001), rotas `rag-documents` |
| Reaproveitamento | **Total** — Context Engine usa `resolveContextSources` como fonte de conhecimento |
| Gaps | Não monta contexto *operacional* (cliente, CRM, agenda, tickets) — só conhecimento documental |

## 3. NLP

| Item | Detalhe |
|---|---|
| Localização | `api/services/nlpService.js` (cliente do serviço Python `/rag/analyze`) |
| Responsabilidade | `analyzeText` (intent, sentiment, entities via Python), `normalizeText`, `extractKeywords` (local) |
| Maturidade | Média — depende do serviço Python estar de pé |
| Reaproveitamento | **Total** — Intent Engine usa `normalizeText` para regras determinísticas |
| Gaps | Sem taxonomia de intenções de negócio (criar_lead, agendar, etc.) |

## 4. Intent Classification

| Item | Detalhe |
|---|---|
| Localização | `api/modules/agent-os/routes/agent-orchestrator.js` (intentMap fixo: whatsapp_message, customer_inquiry, appointment_request, payment_reminder, campaign_trigger, knowledge_query); `api/services/intents.service.js` (geração de intents FAQ via LLM); `api/services/faq.service.js` |
| Responsabilidade | Mapeamento intent → agentes/capabilities (estático, sem classificação a partir de texto) |
| Maturidade | Parcial — recebe `intent` pronto no body; não classifica mensagem livre, não tem confidence, não tem fallback/handoff |
| Eventos produzidos | `ai_governance_records` (logGovernanceEvent) |
| Reaproveitamento | Capability registry e governance log reaproveitados pelo Cognitive Core |
| Gaps | Classificação determinística + LLM com confidence, entities e justificativa **não existem** |

## 5. Workflows / Automações

| Item | Detalhe |
|---|---|
| Localização | `engine/` (núcleo determinístico puro), `api/core/process-runtime/` (durable process runtime), `api/services/flowGeneratorService.impl.js`, `api/services/generationOrchestrator.impl.js`, `api/services/automationService.js`, `api/services/flowEventTriggerService.js`, `api/services/durableProcessService.js`, frontend Flow Editor (Rete 2.x, `nodeSchemas.js`) |
| Maturidade | Alta |
| Reaproveitamento | Execution Engine pode disparar flows existentes; planejamento determinístico segue o mesmo princípio do engine |
| Gaps | Nenhum bloqueante |

## 6. CRM

| Item | Detalhe |
|---|---|
| Localização | `api/modules/crm/routes.js` (accounts, contacts, leads, pipelines, opportunities, activities, timeline — store in-memory por tenant); `api/services/marketing/marketingService.js` (**persistido**: `upsertLead`, `updateLead`, `listLeads`, `getLeadById`, `applyScoring` sobre `MarketingLead`); `api/services/entityProfileService.js` (`buildEntityProfile`) |
| Maturidade | Leads persistidos: alta. Opportunities/pipelines: in-memory (rotas) sem service layer |
| APIs expostas | `/api/crm/*`, `/api/marketing/*` |
| Reaproveitamento | Tools `createLead`/`updateLead`/`searchCustomer` → `marketingService`; `createOpportunity` → store CRM |
| Gaps | Sem service layer exportado para opportunities (lógica embutida nas rotas) |

## 7. Agenda

| Item | Detalhe |
|---|---|
| Localização | `api/services/scheduleService.js` (`createSchedule`, `getSchedule`, `updateScheduleStatus` com ações de reagendar/cancelar, `listSchedules`), `api/services/schedulerService.js`, `api/modules/scheduling-support/`, modelos `Schedule`, `Resource*` |
| Maturidade | Média-alta — service layer completo com confirmação (`requiresConfirmation`) |
| Reaproveitamento | Tools `createAppointment`/`rescheduleAppointment`/`cancelAppointment` → `scheduleService` |
| Gaps | Nenhum bloqueante |

## 8. Inbox / Conversas

| Item | Detalhe |
|---|---|
| Localização | `api/modules/inbox/` (`createInboxService`), `api/services/channelConversationService.js`, `api/services/messageProcessor.js` (895 linhas — pipeline de mensagens inbound), `api/services/handoverService.js` (`takeOver`, `returnToBot` — transferência p/ humano), modelos `ChannelConversation`, `ChannelMessage` |
| Maturidade | Alta |
| Reaproveitamento | `messageProcessor` é o ponto natural de entrada do Cognitive Orchestrator; tool `transferConversation` → `handoverService.takeOver` |
| Gaps | messageProcessor não passa por um pipeline cognitivo unificado |

## 9. PBX / Voz

| Item | Detalhe |
|---|---|
| Localização | `pbx/` (Asterisk), `api/services/pbx/*` (extensões, CDR, dialplan, operator panel), `api/services/asterisk/amiClient.js` (originate), `api/services/cc/ccClick2CallService.js` (`createClick2CallRequest`), `api/modules/pbx/`, `api/modules/voice/` |
| Maturidade | Alta |
| Reaproveitamento | Tool `originateCall` → `ccClick2CallService.createClick2CallRequest` |
| Gaps | Nenhum bloqueante |

## 10. Campanhas

| Item | Detalhe |
|---|---|
| Localização | `api/services/cc/ccCampaignsService.js` (`upsertCampaign`, `addCampaignListItems`), `api/services/marketing/marketingService.js` (`createEmailCampaign`, `sendEmailCampaignNow`), `api/services/bulkMessagingService.js`, `api/modules/bulk-campaigns/` |
| Maturidade | Alta |
| Reaproveitamento | Tool `createCampaign` → `ccCampaignsService.upsertCampaign` |
| Gaps | Nenhum bloqueante |

## 11. Analytics / Métricas

| Item | Detalhe |
|---|---|
| Localização | `api/services/analyticsService.js`, `api/modules/analytics/`, `api/modules/intelligence/handleIntelligenceAnalyticsRoutes.js`, modelos `TenantMetricSnapshot`, `TenantInsight`, `TenantGoal`, `TenantRecommendation` |
| Maturidade | Alta |
| Reaproveitamento | Context Engine consulta métricas; intent `consultar_metricas` |
| Gaps | Nenhum bloqueante |

## 12. QA Waves / QA Mesh / Replay / RPA / Seeds

| Item | Detalhe |
|---|---|
| Localização | `qa/`, `qa-waves/`, `qa-mesh/`, `core/rpa/` (recorder, player, replay, bugResolution), `core/rpa/seeds/`, `governance/` (replay integrity, tamper detection, self-proving) |
| Maturidade | Alta — gates de release |
| Visibilidade | **DEVELOPMENT/SUPPORT** — política em `api/modules/agent-os/experience-segregation.js` (`PRODUCTION_HIDDEN_ROUTES` cobre `/dev/qa-waves`, `/qa-mesh`, `/rpa-*`, `/rpa-seeds`, etc.) |
| Reaproveitamento | QA Waves valida o Cognitive Core (gate externo); o Cognitive Core **não** os expõe a usuários operacionais |
| Gaps | Capabilities `qa.*`/`replay.*` do agent-orchestrator precisam continuar bloqueadas para operação no Tool Registry |

## 13. Event Bus / Eventos

| Item | Detalhe |
|---|---|
| Localização | `api/services/eventLedgerService.js` (`appendEventV1`, `listEvents` — ledger canônico em `event_ledger`), `api/services/eventLedgerTriggerDispatcher.js`, `api/services/flowEventTriggerService.js`, `api/events/eventModelV1.js`, WebSocket (`ws`) para realtime |
| Maturidade | Alta |
| Reaproveitamento | **Total** — execuções cognitivas são registradas como eventos canônicos (`cognitive.execution.*`) com correlationId |
| Gaps | Nenhum |

## 14. Logs / Auditoria

| Item | Detalhe |
|---|---|
| Localização | `api/utils/logger.js` (obrigatório, nunca console.log), `api/services/auditService.js`, `api/modules/ai-governance/service.js` (`logGovernanceEvent`, `getAuditTrail`, `getDecisionLog`, `generateComplianceReport` sobre `ai_governance_records`) |
| Maturidade | Alta |
| Reaproveitamento | **Total** — Learning Engine e Execution Engine registram via governance + ledger |
| Gaps | Sem registro estruturado específico de execução cognitiva (executionId, intent, confidence, plan, toolsExecuted, latencyMs, fallback, humanHandoff) |

## 15. Multi-Tenant

| Item | Detalhe |
|---|---|
| Localização | Todos os modelos com `tenant_id`; `api/modules/tenant/`; stores in-memory por tenant; `requirePermission(req, resource, action)` no route registry |
| Maturidade | Alta |
| Reaproveitamento | Total — todo o Cognitive Core valida `tenantId` em cada camada |
| Gaps | Nenhum |

## 16. Workspace

| Item | Detalhe |
|---|---|
| Localização | `api/services/workspace/` (`WorkspaceEntityService`, `WorkspaceInsightService`, `WorkspaceActionService`, `WorkspaceTimelineService`, `WorkspaceOperationsService`, `WorkspaceLinkAutomationService`), `api/modules/workspace/`, frontend `workspaceAreas.js` |
| Maturidade | Alta — é o single pane operacional |
| Reaproveitamento | Tool `generateInsight` → `WorkspaceInsightService.persistInsight`; resultados cognitivos aparecem como insights/ações/timeline |
| Gaps | Nenhum |

## 17. Agent OS (camada existente — 2026-06-11)

| Item | Detalhe |
|---|---|
| Localização | `api/modules/agent-os/` (orchestrator, factory, experience-segregation), `api/modules/agent-registry/`, `api/modules/knowledge-graph/`, `api/modules/journey-registry/`, `api/modules/rap-learn/`, `api/modules/ai-governance/`, `api/modules/agent-marketplace/`, `api/modules/vertical-templates/` |
| Responsabilidade | Registro de agentes corporativos (PRODUCTION/SUPPORT/DEVELOPMENT), knowledge graph, jornadas, aprendizado (LearningRecord), governança |
| Maturidade | Média — capability registry com fallbacks silenciosos (`require` de serviços inexistentes como `crmService`/`ticketService` cai em catch) |
| Eventos produzidos | `ai_governance_records`, `learning_records` |
| Reaproveitamento | **Agent OS passa a ser a camada opcional de agentes sobre o Cognitive Core.** O capability/governance/learning são consumidos pelo núcleo |
| Gaps | Sem Context Engine, sem Intent Engine real, sem Action Planner, sem Validation Engine; execução acoplada a rotas HTTP |

## 18. Learning

| Item | Detalhe |
|---|---|
| Localização | `api/modules/rap-learn/service.js` (`recordFailure`, `classifyFailure`, `generateSuggestion`, `validateSuggestion`, `promoteToProduction`, `detectRegressions`) sobre modelo `LearningRecord` (types: failure, regression, pattern, improvement, correction, promotion) |
| Maturidade | Média — pipeline de falha→correção existe; não registra execuções cognitivas de sucesso |
| Reaproveitamento | Learning Engine grava `LearningRecord` (type `pattern`/`failure`) por execução cognitiva |
| Gaps | Registro de execução (sucesso, latência, fallback, handoff, resultado de negócio) não existe |

---

## Conclusão da auditoria

O RAP já possui **quase todos os órgãos** do Cognitive Core dispersos: providers de IA por tenant, RAG/NLP, capability registry, segregação PRODUCTION/SUPPORT/DEVELOPMENT, event ledger, governança de IA, learning records, handover humano e serviços de domínio reais (leads, agenda, tickets via `queueService.createTicket`, WhatsApp, click2call, campanhas, insights).

O que **não existe** é o núcleo que liga tudo: um pipeline obrigatório INPUT → CONTEXT → INTENT → PLAN → EXECUTE → VALIDATE → LEARN, com Tool Registry único, validação de tenant/permissão/visibilidade em cada passo e registro estruturado de execução. É exatamente isso que o Cognitive Core consolida em `src/core/cognitive/`, **reutilizando** os serviços acima sem duplicá-los.

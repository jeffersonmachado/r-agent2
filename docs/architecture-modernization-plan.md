# Plano de Modernizacao Arquitetural

## Atualizacao 2026-03-22 (hardening final de backend)
- Macro-refatoracao de servidor/roteamento permanece concluida (`server.js` entrypoint fino, `registerRoutes.js` declarativo, `routeRegistry.js` manifesto).
- Novo foco canônico: consolidacao interna de services/composition/modules, com reducao de complexidade em hotspots reais.
- Hotspots de service priorizados para fechamento:
  1. `api/services/rpaService.js`
  2. `api/services/ragDocumentsService.js`
  3. `api/services/flowGeneratorService.js`
  4. `api/services/tenantService.js`
  5. `api/services/queueService.js`
  6. `api/services/rpaTestGeneratorService.js`
  7. `api/services/generationOrchestrator.js`
  8. `api/services/ragService.js`
  9. `api/services/operationsDashboardService.js`
  10. `api/core/process-runtime/processRuntimeService.js`
- Ciclo aplicado nesta data:
  - utilitario compartilhado `api/utils/defensiveCoercion.js` criado;
  - coercao defensiva padronizada em 8 hotspots (`rpaService`, `ragDocumentsService`, `flowGeneratorService`, `tenantService`, `queueService`, `rpaTestGeneratorService`, `generationOrchestrator`, `ragService`);
  - `api/server.js` passou a reutilizar `requireTenant` compartilhado de `api/composition/shared/requireTenant.js`.
- Pendencias prioritarias abertas:
  - concluir decomposicao de `queueService` apos extrações ja aplicadas (`queueTicketPersistenceMapper`, `queueIndexStore`, `queueTicketMessaging`, `queueTicketRetention`, `queueTicketMetrics`, `queueTicketQuery`, `queueTicketMode`, `queueTicketLifecycle`, `queueTicketOrderIncident`, `queueTicketConversationSync`, `queueTicketPersistenceRuntime`, `queueTicketFactory`);
  - decompor `queueService`, `operationsDashboardService` e `processRuntimeService` em colaboradores coesos (operations dashboard ja iniciou split com `operationsDashboardHelpers`, `operationsDashboardCandidates`, `operationsDashboardNotifications`, `operationsDashboardInsights`; runtime com `processRuntimeHelpers`, `processRuntimeWaitingState`, `processRuntimeResult`, `processRuntimeSubprocess`, `processRuntimeTimeoutPolicy`, `processRuntimeIdempotency`, `processRuntimeWaitingFlow`, `processRuntimeNodeSignals`, `processRuntimeNodeFailure`, `processRuntimeCompletionFlow`, `processRuntimeNodeExitFlow`, `processRuntimeNodeEntryFlow`, `processRuntimeNodeAttempts`, `processRuntimeMissingNodeFailure`, `processRuntimeNextNodeSetup` e `processRuntimeNodeStep`);
  - reduzir modulos `handle*Routes` superdimensionados em `api/modules/*`.

## Atualizacao 2026-03-22 (timeout policy runtime)
- Extraido novo colaborador `api/core/process-runtime/processRuntimeTimeoutPolicy.js` para concentrar calculo de timeout por no e execucao com timeout.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar `executeNodeWithPolicies` para o helper de timeout, mantendo semantica de erro `NODE_TIMEOUT`.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeIdempotency.js` para centralizar a politica de `runOnce` e restauracao de snapshot quando ha reaproveitamento.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar `executeNodeWithIdempotency` para helper dedicado.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeWaitingFlow.js` para centralizar a transicao de waiting (derive/persist/event/deferred-start).
- `api/core/process-runtime/processRuntimeService.js` passou a delegar a transicao de waiting para helper dedicado.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeNodeSignals.js` para centralizar sinais por tipo de no (`GATEWAY_DECISION`, `SUBPROCESS_ENTER`, `HUMAN_HANDOFF`, `NODE_FALLBACK`, `SUBPROCESS_EXIT`).
- `api/core/process-runtime/processRuntimeService.js` passou a delegar os sinais de no para helper dedicado.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeNodeFailure.js` para centralizar o tratamento de falha de no (`NODE_TIMEOUT`, `NODE_ERROR`, `PROCESS_FAILED` e notify parent).
- `api/core/process-runtime/processRuntimeService.js` passou a delegar o fluxo de falha para helper dedicado.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeCompletionFlow.js` para centralizar a transicao de conclusao (`PROCESS_COMPLETED` + cancelamento de timers + notify parent).
- `api/core/process-runtime/processRuntimeService.js` passou a delegar o fluxo de conclusao para helper dedicado.
- Extraido novo colaborador `api/core/process-runtime/processRuntimeNodeExitFlow.js` para centralizar `NODE_EXIT` e persistencia de snapshot apos execucao do no.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar o fluxo de saida de no para helper dedicado.
- `api/core/process-runtime/processRuntimeService.js` reduzido para 675 linhas apos os recortes.
- Validacao do recorte:
  - `node --check api/core/process-runtime/processRuntimeTimeoutPolicy.js`
  - `node --check api/core/process-runtime/processRuntimeIdempotency.js`
  - `node --check api/core/process-runtime/processRuntimeWaitingFlow.js`
  - `node --check api/core/process-runtime/processRuntimeNodeSignals.js`
  - `node --check api/core/process-runtime/processRuntimeNodeFailure.js`
  - `node --check api/core/process-runtime/processRuntimeCompletionFlow.js`
  - `node --check api/core/process-runtime/processRuntimeNodeExitFlow.js`
  - `node --check api/core/process-runtime/processRuntimeService.js`
  - `npx jest tests/unit/processDurableRuntime.test.js --runInBand` (17/17)

## Atualizacao 2026-03-22 (queue conversation sync)
- Extraido novo colaborador `api/services/queue/queueTicketConversationSync.js` para concentrar sincronizacao best-effort de `channel_conversation`.
- `api/services/queueService.js` passou a delegar `updateConversationForTicket` para helper dedicado, removendo acoplamento direto ao model de conversa no service principal.
- `api/services/queueService.js` reduzido para 886 linhas apos o recorte.
- Validacao do recorte:
  - `node --check api/services/queue/queueTicketConversationSync.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (queue persistence runtime)
- Extraido novo colaborador `api/services/queue/queueTicketPersistenceRuntime.js` para concentrar persistencia best-effort e bootstrap de cache runtime a partir do PostgreSQL.
- `api/services/queueService.js` passou a delegar `persistTicketBestEffort`, `deleteTicketBestEffort` e `initialize` para helper dedicado.
- `api/services/queueService.js` reduzido para 848 linhas apos o recorte.
- Validacao do recorte:
  - `node --check api/services/queue/queueTicketPersistenceRuntime.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (queue ticket factory)
- Extraido novo colaborador `api/services/queue/queueTicketFactory.js` para centralizar a montagem do payload inicial de ticket (incluindo normalizacao de canal/telefone/mensagem bootstrap/contexto).
- `api/services/queueService.js` passou a delegar a construcao de ticket para helper dedicado em `createTicket`.
- `api/services/queueService.js` reduzido para 805 linhas apos o recorte.
- Validacao do recorte:
  - `node --check api/services/queue/queueTicketFactory.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (node entry runtime)
- Extraido novo colaborador `api/core/process-runtime/processRuntimeNodeEntryFlow.js` para centralizar a emissao de `NODE_ENTER` com snapshots de variaveis e historico.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar a emissao de entrada de no para helper dedicado.
- `api/core/process-runtime/processRuntimeService.js` reduzido para 673 linhas apos os recortes.
- Validacao do recorte:
  - `node --check api/core/process-runtime/processRuntimeNodeEntryFlow.js`
  - `node --check api/core/process-runtime/processRuntimeService.js`
  - `npx jest tests/unit/processDurableRuntime.test.js --runInBand` (17/17)

## Atualizacao 2026-03-22 (node attempts runtime)
- Extraido novo colaborador `api/core/process-runtime/processRuntimeNodeAttempts.js` para centralizar o incremento de `metadata.nodeAttempts` por no.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar a atualizacao do contador de tentativas para helper dedicado.
- `api/core/process-runtime/processRuntimeService.js` reduzido para 668 linhas apos os recortes.
- Validacao do recorte:
  - `node --check api/core/process-runtime/processRuntimeNodeAttempts.js`
  - `node --check api/core/process-runtime/processRuntimeService.js`
  - `npx jest tests/unit/processDurableRuntime.test.js --runInBand` (17/17)

## Atualizacao 2026-03-22 (runtime step consolidation)
- Extraidos novos colaboradores `api/core/process-runtime/processRuntimeMissingNodeFailure.js`, `api/core/process-runtime/processRuntimeNextNodeSetup.js` e `api/core/process-runtime/processRuntimeNodeStep.js` para consolidar preambulo/guarda e passo completo do loop de execucao.
- `api/core/process-runtime/processRuntimeService.js` passou a delegar o setup de `executeNextNode`, o fallback de no ausente e o processamento de cada no para helper dedicado.
- `api/core/process-runtime/processRuntimeService.js` reduzido para 595 linhas (alvo sub-650 atingido).
- Validacao do recorte:
  - `node --check api/core/process-runtime/processRuntimeMissingNodeFailure.js`
  - `node --check api/core/process-runtime/processRuntimeNextNodeSetup.js`
  - `node --check api/core/process-runtime/processRuntimeNodeStep.js`
  - `node --check api/core/process-runtime/processRuntimeService.js`
  - `npx jest tests/unit/processDurableRuntime.test.js --runInBand` (17/17)

## Atualizacao 2026-03-22 (queue admin operations)
- Extraido novo colaborador `api/services/queue/queueAdminOperations.js` centralizando `createQueue`, `deleteQueue` e `getQueueInfo` com injecao de dependencias via objeto `deps`.
- `api/services/queueService.js` passou a delegar as tres funcoes admin de fila para o novo helper via thin wrappers.
- `api/services/queueService.js` reduzido de 805 para 657 linhas (−148).
- Validacao do recorte:
  - `node --check api/services/queue/queueAdminOperations.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (dashboard timeline mapper + jobs aggregator)
- Extraido `api/services/operations/operationsDashboardTimelineMapper.js` com tres mappers puros: `mapJourneyTimelineItems`, `mapAttendanceTimelineItems`, `mapMembershipTimelineItems`.
- Extraido `api/services/operations/operationsDashboardJobsAggregator.js` com `mapJobRows`, `aggregateJobsByKind` e `buildJobsSummary`.
- `api/services/operationsDashboardService.js` passou a delegar os dois blocos para os novos helpers.
- `api/services/operationsDashboardService.js` reduzido de 711 para 570 linhas (−141).
- Validacao do recorte:
  - `node --check api/services/operations/operationsDashboardTimelineMapper.js`
  - `node --check api/services/operations/operationsDashboardJobsAggregator.js`
  - `node --check api/services/operationsDashboardService.js`

## Atualizacao 2026-03-22 (dashboard summary extraction)
- Extraido `api/services/operations/operationsDashboardSummary.js` com a logica completa de `computeSummary` (queries, agregacoes e montagem do payload final).
- `api/services/operationsDashboardService.js` passou a delegar `computeSummary` para o helper por injeção de dependencias.
- `api/services/operationsDashboardService.js` reduzido de 570 para 412 linhas (−158).
- Validacao do recorte:
  - `node --check api/services/operations/operationsDashboardSummary.js`
  - `node --check api/services/operationsDashboardService.js`
  - `npx jest tests/unit/operationsDashboardService.test.js --runInBand` (6/6)

## Atualizacao 2026-03-22 (dashboard notifications listing extraction)
- Extraido `api/services/operations/operationsDashboardNotificationsListing.js` consolidando a rotina completa de `listNotifications` (query em ledger, fallback proxy de journey, filtros, resumo e paginacao).
- `api/services/operationsDashboardService.js` passou a delegar `listNotifications` para o helper por injecao de dependencias.
- `api/services/operationsDashboardService.js` reduzido de 412 para 366 linhas (−46).
- Validacao do recorte:
  - `node --check api/services/operations/operationsDashboardNotificationsListing.js`
  - `node --check api/services/operationsDashboardService.js`
  - `npx jest tests/unit/operationsDashboardService.test.js --runInBand` (6/6)

## Atualizacao 2026-03-22 (dashboard jobs listing extraction)
- Extraido `api/services/operations/operationsDashboardJobsListing.js` consolidando a rotina de `listJobs` (where dinamico por vertical, consulta, filtros por status, resumo, agregacao por kind e paginacao).
- `api/services/operationsDashboardService.js` passou a delegar `listJobs` para o helper por injecao de dependencias.
- `api/services/operationsDashboardService.js` reduzido de 366 para 334 linhas (−32).
- Validacao do recorte:
  - `node --check api/services/operations/operationsDashboardJobsListing.js`
  - `node --check api/services/operationsDashboardService.js`
  - `npx jest tests/unit/operationsDashboardService.test.js --runInBand` (6/6)

## Atualizacao 2026-03-22 (dashboard timeline listing extraction)
- Extraido `api/services/operations/operationsDashboardTimelineListing.js` consolidando a rotina de `listTimeline` (filtros por vertical/sujeito/cliente/membership, merge de eventos, ordenacao e paginacao).
- `api/services/operationsDashboardService.js` passou a delegar `listTimeline` para o helper por injecao de dependencias.
- `api/services/operationsDashboardService.js` reduzido de 334 para 264 linhas (−70).
- Validacao do recorte:
  - `node --check api/services/operations/operationsDashboardTimelineListing.js`
  - `node --check api/services/operationsDashboardService.js`
  - `npx jest tests/unit/operationsDashboardService.test.js --runInBand` (6/6)

## Atualizacao 2026-03-22 (queue read operations extraction)
- Extraido `api/services/queue/queueTicketReadOperations.js` centralizando operacoes de leitura/listagem (`listQueue`, `listQueues`, `getTicket`, `getTicketBySession`, `getTicketByConversationId`, `getTicketMessages`, `listAllTickets`).
- `api/services/queueService.js` passou a delegar esse conjunto para helper por injecao de dependencias.
- `api/services/queueService.js` reduzido de 657 para 642 linhas (−15).
- Validacao do recorte:
  - `node --check api/services/queue/queueTicketReadOperations.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (queue mutation operations extraction)
- Extraido `api/services/queue/queueTicketMutationOperations.js` centralizando operacoes de mutacao (`assignTicket`, `closeTicket`, `updateTicket`, `updateLastMessage`, `addAgentMessage`, `addTicketNote`, `transferTicket`, `updateOutboundMessageMeta`, `markMessagesAsRead`, `setTicketMode`).
- `api/services/queueService.js` passou a delegar esse conjunto para helper por injecao de dependencias.
- `api/services/queueService.js` reduzido de 642 para 595 linhas (−47).
- Validacao do recorte:
  - `node --check api/services/queue/queueTicketMutationOperations.js`
  - `node --check api/services/queueService.js`
  - `npx jest tests/unit/queueService.test.js --runInBand` (15/15)

## Atualizacao 2026-03-22 (BE-022 agent routes MFA extraction)
- Extraido `api/modules/domain-identity/handleAgentMfaRoutes.js` consolidando o bloco MFA de `handleAgentRoutes` (`/auth/mfa/setup`, `/auth/mfa/verify`, `/auth/mfa/disable`, `/auth/mfa/recovery`).
- `api/modules/domain-identity/handleAgentRoutes.js` passou a delegar o bloco MFA para helper dedicado.
- `api/modules/domain-identity/handleAgentRoutes.js` reduzido de 567 para 436 linhas (−131).
- Validacao do recorte:
  - `node --check api/modules/domain-identity/handleAgentMfaRoutes.js`
  - `node --check api/modules/domain-identity/handleAgentRoutes.js`
  - `npx jest tests/unit/agentRoutes.test.js --runInBand` (26/26)

## Atualizacao 2026-03-22 (BE-022 agent routes onboarding/password extraction)
- Extraido `api/modules/domain-identity/handleAgentOnboardingRoutes.js` consolidando o bloco de onboarding/password de `handleAgentRoutes` (`/auth/invite`, `/auth/accept-invitation`, `/auth/request-password-reset`, `/auth/reset-password`).
- `api/modules/domain-identity/handleAgentRoutes.js` passou a delegar esse bloco para helper dedicado.
- `api/modules/domain-identity/handleAgentRoutes.js` reduzido de 436 para 299 linhas (−137).
- Validacao do recorte:
  - `node --check api/modules/domain-identity/handleAgentOnboardingRoutes.js`
  - `node --check api/modules/domain-identity/handleAgentRoutes.js`
  - `npx jest tests/unit/agentRoutes.test.js --runInBand` (26/26)

## Atualizacao 2026-03-22 (BE-022 agent routes CRUD extraction)
- Extraido `api/modules/domain-identity/handleAgentCrudRoutes.js` consolidando o bloco CRUD de `handleAgentRoutes` (`GET/POST /auth/agents`, `GET/PUT/DELETE /auth/agents/:id`).
- `api/modules/domain-identity/handleAgentRoutes.js` passou a delegar o bloco CRUD para helper dedicado.
- `api/modules/domain-identity/handleAgentRoutes.js` reduzido de 299 para 107 linhas (−192).
- Validacao do recorte:
  - `node --check api/modules/domain-identity/handleAgentCrudRoutes.js`
  - `node --check api/modules/domain-identity/handleAgentRoutes.js`
  - `npx jest tests/unit/agentRoutes.test.js --runInBand` (26/26)

## Atualizacao 2026-03-22 (BE-022 physical public kiosk/panel extraction)
- Extraido `api/modules/platform-public/handlePhysicalKioskPanelRoutes.js` consolidando o bloco de `/physical/kiosk/tickets` e `/physical/panel/state`.
- Extraido `api/modules/platform-public/handlePhysicalPublicRouteUtils.js` para centralizar utilitarios comuns (`resolvePublicTokenByKind`, `enforcePublicRateLimit`, `getIpAddress`).
- `api/modules/platform-public/handlePhysicalPublicRoutes.js` passou a delegar kiosk/panel para helper dedicado e manter foco no bloco de access-control.
- `api/modules/platform-public/handlePhysicalPublicRoutes.js` reduzido de 517 para 307 linhas (−210).
- Validacao do recorte:
  - `node --check api/modules/platform-public/handlePhysicalPublicRouteUtils.js`
  - `node --check api/modules/platform-public/handlePhysicalKioskPanelRoutes.js`
  - `node --check api/modules/platform-public/handlePhysicalPublicRoutes.js`
  - `npx jest tests/unit/physicalPublicRoutes.test.js --runInBand` (12/12)

## Atualizacao 2026-03-22 (BE-022 physical public access-control extraction)
- Extraido `api/modules/platform-public/handlePhysicalAccessControlPublicRoutes.js` consolidando o bloco de `/physical/access/resolve`, `/physical/access/events` e `/physical/access/ack`.
- `api/modules/platform-public/handlePhysicalPublicRoutes.js` virou orquestrador fino delegando para `handlePhysicalKioskPanelRoutes` e `handlePhysicalAccessControlPublicRoutes`.
- `api/modules/platform-public/handlePhysicalPublicRoutes.js` reduzido de 307 para 45 linhas (−262).
- Validacao do recorte:
  - `node --check api/modules/platform-public/handlePhysicalAccessControlPublicRoutes.js`
  - `node --check api/modules/platform-public/handlePhysicalKioskPanelRoutes.js`
  - `node --check api/modules/platform-public/handlePhysicalPublicRoutes.js`
  - `npx jest tests/unit/physicalPublicRoutes.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 scheduling support calendar extraction)
- Extraido `api/modules/scheduling-support/handleSchedulingSupportCalendarRoutes.js` consolidando o bloco de calendario (`/api/calendar/me`, `/api/calendar/resource/*`, `POST/DELETE /api/calendar/resource/:id/blocks`).
- `api/modules/scheduling-support/handleSchedulingSupportRoutes.js` passou a delegar o bloco de calendario para helper dedicado e manteve foco nos endpoints de busca (`users/teams/purposes/crm`).
- `api/modules/scheduling-support/handleSchedulingSupportRoutes.js` reduzido de 435 para 267 linhas (−168).
- Validacao do recorte:
  - `node --check api/modules/scheduling-support/handleSchedulingSupportCalendarRoutes.js`
  - `node --check api/modules/scheduling-support/handleSchedulingSupportRoutes.js`
  - `npx jest tests/unit/schedulingSupportRoutes.test.js tests/unit/schedulingSupportModuleRoutes.test.js --runInBand --silent` (7/7)

## Atualizacao 2026-03-22 (BE-022 fitness membership extraction)
- Extraido `api/modules/vertical/handleFitnessMembershipRoutes.js` consolidando os endpoints de membership (`GET /api/fitness/membership/:id`, `PATCH .../billing`, `PATCH .../details`, `POST .../grace-period`, `POST .../renew`, `GET .../billing-history`).
- `api/modules/vertical/handleFitnessRoutes.js` passou a delegar o bloco de membership para helper dedicado, preservando o restante dos fluxos de attendance/metrics/timeline.
- `api/modules/vertical/handleFitnessRoutes.js` reduzido de 581 para 504 linhas (−77).
- Validacao do recorte:
  - `node --check api/modules/vertical/handleFitnessMembershipRoutes.js`
  - `node --check api/modules/vertical/handleFitnessRoutes.js`
  - `npx jest tests/unit/verticalFitnessRoutes.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 fitness attendance extraction)
- Extraido `api/modules/vertical/handleFitnessAttendanceRoutes.js` consolidando endpoints de attendance (`GET /api/fitness/subject/:subjectId/attendance`, `POST /api/fitness/attendance/check-in`, `POST /api/fitness/attendance/check-out`, `GET /api/fitness/attendance/open`).
- `api/modules/vertical/handleFitnessRoutes.js` passou a delegar o bloco de attendance para helper dedicado, mantendo o fluxo de detail/churn/metrics/journey no modulo principal.
- `api/modules/vertical/handleFitnessRoutes.js` reduzido de 504 para 462 linhas (−42).
- Validacao do recorte:
  - `node --check api/modules/vertical/handleFitnessAttendanceRoutes.js`
  - `node --check api/modules/vertical/handleFitnessMembershipRoutes.js`
  - `node --check api/modules/vertical/handleFitnessRoutes.js`
  - `npx jest tests/unit/verticalFitnessRoutes.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 intelligence analytics extraction)
- Extraido `api/modules/intelligence/handleIntelligenceAnalyticsRoutes.js` consolidando o bloco de analytics read (`POST /api/intelligence/metrics/snapshots`, `GET /api/intelligence/insights`, `GET /api/intelligence/insights/:id/evidence`, `GET /api/intelligence/recommendations`).
- `api/modules/intelligence/handleIntelligenceRoutes.js` passou a delegar este bloco para helper dedicado, mantendo no modulo principal os fluxos de search, operational-state e goals.
- `api/modules/intelligence/handleIntelligenceRoutes.js` reduzido de 357 para 280 linhas (−77).
- Validacao do recorte:
  - `node --check api/modules/intelligence/handleIntelligenceAnalyticsRoutes.js`
  - `node --check api/modules/intelligence/handleIntelligenceRoutes.js`
  - `npx jest tests/unit/intelligenceRoutes.test.js tests/unit/tenantIntelligenceRoutesExpanded.test.js --runInBand --silent` (46/46)

## Atualizacao 2026-03-22 (BE-022 intelligence goals extraction)
- Extraido `api/modules/intelligence/handleIntelligenceGoalRoutes.js` consolidando o bloco de goals (`GET /api/intelligence/goals`, `POST /api/intelligence/goals`, `PUT /api/intelligence/goals/:id`).
- `api/modules/intelligence/handleIntelligenceRoutes.js` passou a delegar goals para helper dedicado, mantendo no modulo principal os fluxos de search e operational-state.
- `api/modules/intelligence/handleIntelligenceRoutes.js` reduzido de 280 para 214 linhas (−66).
- Validacao do recorte:
  - `node --check api/modules/intelligence/handleIntelligenceGoalRoutes.js`
  - `node --check api/modules/intelligence/handleIntelligenceAnalyticsRoutes.js`
  - `node --check api/modules/intelligence/handleIntelligenceRoutes.js`
  - `npx jest tests/unit/intelligenceRoutes.test.js tests/unit/tenantIntelligenceRoutesExpanded.test.js --runInBand --silent` (46/46)

## Atualizacao 2026-03-22 (BE-022 flow CRUD read extraction)
- Extraido `api/modules/domain-flow/handleFlowCrudReadRoutes.js` consolidando o bloco de leitura (`GET /flows`, `GET /flows/:id`) de `handleFlowCrudRoutes`.
- `api/modules/domain-flow/handleFlowCrudRoutes.js` passou a delegar leitura para helper dedicado e manteve mutacoes (`POST`, `PUT`, `DELETE`) no modulo principal.
- `api/modules/domain-flow/handleFlowCrudRoutes.js` reduzido de 561 para 479 linhas (−82).
- Validacao do recorte:
  - `node --check api/modules/domain-flow/handleFlowCrudReadRoutes.js`
  - `node --check api/modules/domain-flow/handleFlowCrudRoutes.js`
  - `npx jest tests/unit/domainAdminIdentityFlowCutoverWiring.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 channel-webhook full decomposition)
## Atualizacao 2026-03-22 (BE-022 access-control full decomposition)
## Atualizacao 2026-03-22 (BE-022 process-runtime full decomposition)
## Atualizacao 2026-03-22 (BE-022 public-token full decomposition)
## Atualizacao 2026-03-22 (BE-022 ai-routes full decomposition)
- `api/modules/platform-content/handleAiRoutes.js` (372 linhas) decomposto em 2 helpers por endpoint:
  - `handleAiChatbotOrchestratorRoutes.js`: `POST /ai/chatbot/generate` + `POST /ai/rpa/generate` — ambos delegam ao `orchestrateGeneration`, mesmo servico, logica similar
  - `handleAiGenerateRoute.js`: `POST /api/ai/generate` — endpoint de IA direta com pipeline WebSocket, rate limit handling, `generateAiResponse`, `apiErrorHandler`
- `api/modules/platform-content/handleAiRoutes.js` tornou-se delegador de 13 linhas com guards de prefixo `/ai/` e `/api/ai/` (−359 linhas).
- Validacao:
  - `node --check api/modules/platform-content/handleAiChatbotOrchestratorRoutes.js` OK
  - `node --check api/modules/platform-content/handleAiGenerateRoute.js` OK
  - `node --check api/modules/platform-content/handleAiRoutes.js` OK
  - `npx jest tests/unit/platformResidualEliminationWiring.test.js --runInBand --silent` → 5/5 passing

## Atualizacao 2026-03-22 (BE-022 public-token full decomposition)
- `api/modules/public-token/handlePublicTokenRoutes.js` (321 linhas) decomposto em 2 helpers por dominio:
  - `handlePublicTokenCrudRoutes.js`: `GET /public-tokens` (list), `GET /public-tokens/stats`, `POST /public-tokens` (create) — operacoes de catalogo autenticadas
  - `handlePublicTokenLifecycleRoutes.js`: `POST /public-tokens/:id/revoke`, `POST /public-tokens/:id/rotate`, `GET /public-tokens/resolve` (com rate limiting, endpoint publico) — operacoes de ciclo de vida
- `api/modules/public-token/handlePublicTokenRoutes.js` tornou-se delegador puro de 13 linhas (−308).
- Validacao:
  - `node --check api/modules/public-token/handlePublicTokenCrudRoutes.js` OK
  - `node --check api/modules/public-token/handlePublicTokenLifecycleRoutes.js` OK
  - `node --check api/modules/public-token/handlePublicTokenRoutes.js` OK
  - `npx jest tests/unit/publicTokenRoutes.test.js --runInBand --silent` → 9/9 passing

## Atualizacao 2026-03-22 (BE-022 process-runtime full decomposition)
- `api/modules/process-runtime/handleProcessRuntimeRoutes.js` (333 linhas) decomposto em 2 helpers por prefixo de URL:
  - `handleProcessRuntimeControlRoutes.js`: `POST /api/process-runtime/start`, `GET /api/process-runtime/analytics`, `POST /api/process-runtime/simulate`, `POST /api/process-runtime/intelligence`
  - `handleProcessInstanceRoutes.js`: `GET /api/process-instances`, `POST /api/process-instances/resume/external`, `GET/POST /api/process-instances/:id` (detail, history, cancel, resume)
- Nota: auth gate centralizado preservado no modulo pai (19 linhas) — compartilhado pelos dois helpers.
- Validacao:
  - `node --check api/modules/process-runtime/handleProcessRuntimeControlRoutes.js` OK
  - `node --check api/modules/process-runtime/handleProcessInstanceRoutes.js` OK
  - `node --check api/modules/process-runtime/handleProcessRuntimeRoutes.js` OK
  - `npx jest tests/unit/processRuntimeRoutes.test.js --runInBand --silent` → 4/4 passing

## Atualizacao 2026-03-22 (BE-022 access-control full decomposition)
- `api/modules/access-control/handleAccessControlRoutes.js` (345 linhas) decomposto em 2 helpers por dominio funcional:
  - `handleAccessControlCatalogRoutes.js`: `GET/POST/PATCH /api/access-control/devices|credentials|policies` (CRUD de configuracao, so `accessControlService`)
  - `handleAccessControlDecisionRoutes.js`: `POST /decisions/resolve`, `GET/POST /events`, `GET /decisions`, `GET /health`, `GET /decisions/:id/status`, `POST /visitors/qrcode`, `POST /qrcode/resolve` (motor de decisao — `accessDecisionService` + `decisionStatusService` + `buildVendorCommand`)
- `api/modules/access-control/handleAccessControlRoutes.js` tornou-se delegador puro de 14 linhas (−331).
- Validacao:
  - `node --check api/modules/access-control/handleAccessControlCatalogRoutes.js` OK
  - `node --check api/modules/access-control/handleAccessControlDecisionRoutes.js` OK
  - `node --check api/modules/access-control/handleAccessControlRoutes.js` OK
  - `npx jest tests/unit/accessControlRoutes.test.js --runInBand --silent` → 9/9 passing

## Atualizacao 2026-03-22 (BE-022 channel-webhook full decomposition)
- `api/modules/channel-webhook/handleChannelWebhookRoutes.js` (478 linhas) totalmente decomposto em 3 helpers por plataforma:
  - `handleWhatsAppWebhookRoutes.js`: `GET/POST /webhooks/whatsapp` (hub verify + inbound com ticket + bot dispatch)
  - `handleMessengerWebhookRoutes.js`: `GET/POST /webhooks/messenger` + `POST /messenger/send` (outbound auth-gated)
  - `handleInstagramWebhookRoutes.js`: `GET/POST /webhooks/instagram` + `POST /instagram/send` (outbound auth-gated)
- `api/modules/channel-webhook/handleChannelWebhookRoutes.js` tornou-se delegador puro de 14 linhas (3 await + return false).
- Nota: `extendedChannelCutoverWiring.test.js` tem falha pre-existente (1/2 testes) nao relacionada a esta extracao — o teste 2/2 continua passando.
- Validacao do recorte:
  - `node --check api/modules/channel-webhook/handleWhatsAppWebhookRoutes.js`
  - `node --check api/modules/channel-webhook/handleMessengerWebhookRoutes.js`
  - `node --check api/modules/channel-webhook/handleInstagramWebhookRoutes.js`
  - `node --check api/modules/channel-webhook/handleChannelWebhookRoutes.js`
  - `npx jest tests/unit/extendedChannelCutoverWiring.test.js --runInBand --silent` (1 pre-existing fail inalterado)

## Atualizacao 2026-03-22 (BE-022 templates flow-template marketplace extraction)
- Extraido `api/modules/platform-content/handleFlowTemplateMarketplaceRoutes.js` consolidando `GET /flow-templates` (list com filtros), `GET /flow-templates/:id` (detalhe), `POST /flow-templates` (criar template do tenant), `POST /flow-templates/:id/install` (instanciar template como flow vivo com webhook + emitEvent), `DELETE /flow-templates/:id` (remover template do tenant).
- `api/modules/platform-content/handleTemplatesRoutes.js` passou a delegar todo `/flow-templates/*` para o helper via guard `if (pathname.startsWith('/flow-templates'))` no topo da funcao; retém apenas os endpoints `/templates/*` (file-system JSON).
- `api/modules/platform-content/handleTemplatesRoutes.js` reduzido de 495 para 249 linhas (−246).
- Validacao do recorte:
  - `node --check api/modules/platform-content/handleFlowTemplateMarketplaceRoutes.js`
  - `node --check api/modules/platform-content/handleTemplatesRoutes.js`
  - `npx jest tests/unit/platformResidualEliminationWiring.test.js --runInBand --silent` (5/5)

## Atualizacao 2026-03-22 (BE-022 fitness student routes extraction)
- Extraido `api/modules/vertical/handleFitnessStudentRoutes.js` consolidando `GET /api/fitness/students/search` (busca paginada com lookup de AccessSubject) e `GET /api/fitness/student/:subjectId/detail` (painel agregado: membership + attendance + churn risk + engagement signals + timeline + alerts).
- `api/modules/vertical/handleFitnessRoutes.js` passou a delegar esses endpoints para o helper dedicado, recebendo `ensureAuth` e `tenantId` como props de contexto.
- `api/modules/vertical/handleFitnessRoutes.js` reduzido de 462 para 228 linhas (−234).
- Validacao do recorte:
  - `node --check api/modules/vertical/handleFitnessStudentRoutes.js`
  - `node --check api/modules/vertical/handleFitnessRoutes.js`
  - `npx jest tests/unit/verticalFitnessRoutes.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 flow CRUD delete extraction)
- Extraido `api/modules/domain-flow/handleFlowCrudDeleteRoute.js` consolidando o endpoint `DELETE /flows/:id` (lookup, auth STRICT/DEV, tenant check, delete em memoria + persistencia, webhooks + emitEvent).
- `api/modules/domain-flow/handleFlowCrudRoutes.js` passou a delegar esse endpoint para helper dedicado, mantendo create/update no modulo principal.
- `api/modules/domain-flow/handleFlowCrudRoutes.js` reduzido de 442 para 411 linhas (−31).
- Validacao do recorte:
  - `node --check api/modules/domain-flow/handleFlowCrudDeleteRoute.js`
  - `node --check api/modules/domain-flow/handleFlowCrudRoutes.js`
  - `npx jest tests/unit/domainAdminIdentityFlowCutoverWiring.test.js --runInBand --silent` (12/12)

## Atualizacao 2026-03-22 (BE-022 flow CRUD environment extraction)
- Extraido `api/modules/domain-flow/handleFlowCrudEnvironmentRoute.js` consolidando o endpoint `PUT /flows/:id/environment`.
- `api/modules/domain-flow/handleFlowCrudRoutes.js` passou a delegar esse endpoint para helper dedicado, mantendo create/update/delete no modulo principal.
- `api/modules/domain-flow/handleFlowCrudRoutes.js` reduzido de 479 para 442 linhas (−37).
- Validacao do recorte:
  - `node --check api/modules/domain-flow/handleFlowCrudEnvironmentRoute.js`
  - `node --check api/modules/domain-flow/handleFlowCrudReadRoutes.js`
  - `node --check api/modules/domain-flow/handleFlowCrudRoutes.js`
  - `npx jest tests/unit/domainAdminIdentityFlowCutoverWiring.test.js --runInBand --silent` (12/12)

## Objetivo
Fechar a consolidacao final do backend sem reescrita total, preservando contratos HTTP, flags de ambiente e comportamento operacional.

## Estado atual real (snapshot 2026-03-21)
- `api/server.js`: 212 linhas. Agora atua como entrypoint fino, expondo factories e delegando startup para `api/runtime/startServerRuntime.js`.
- `api/app/registerRoutes.js`: 210 linhas. Agora usa registry declarativo em `api/app/routeRegistry.js` e nao possui mais `buildDeps` inline.
- Bootstrap dedicado:
  - `api/bootstrap/startInitialization.js`
  - `api/bootstrap/systemAdminBootstrap.js`
- Runtime dedicado:
  - `api/runtime/startServerRuntime.js`
  - `api/runtime/startWorkers.js`
  - `api/runtime/registerShutdownHooks.js`
  - `api/runtime/processManager.js`
  - `api/runtime/flowRuntimeState.js`
- Composition roots ativas em `api/composition/`: 34 diretorios. Foram adicionadas roots locais para `queue-ticket`, `ops`, `execution-ledger`, `support-debug`, `public-api`, `channel-webhook`, `whatsapp-connection`, `whatsapp-ivr`, `whatsapp-qr-webhook` e `frontend-fallback`.
- Agregadores `domain-admin`, `domain-identity`, `domain-flow`, `platform-admin`, `platform-content` e `platform-public` tambem passaram a subir por composition roots dedicadas.
- Os builders centrais foram quebrados em slices menores:
  - `api/composition/core/buildCoreRoutingContext.js`: 63 linhas
  - `api/composition/platform/buildPlatformRoutingContext.js`: 60 linhas
  - `api/composition/extended/buildExtendedRoutingContext.js`: 47 linhas
- Bridges residuais reais: nenhuma; o bridge compartilhado tambem foi removido, e nenhum modulo em `api/modules` importa `serverHandlers`.

## O que foi fechado neste ciclo
- `server.js` deixou de concentrar:
  - startup `require.main`
  - bootstrap de `systemadmin`
  - cache/estado de flows e sessions
  - deteccao de process manager
  - helpers mortos como `validateProviderTokenDirect`
- `registerRoutes.js` deixou de concentrar:
  - os 9 `buildDeps` inline remanescentes
  - a ordem de montagem codificada como sequencia aberta de `app.use(...)`
- A reducao mais recente de bridges tambem absorveu:
  - `platform-content`
  - `rag-documents`
- O budget estrutural de imports para `serverHandlers` em `api/modules/*` caiu para `0`.
- O caminho legado `api/serverHandlers/*` foi removido do backend; nao restam arquivos produtivos nem diretorio residual.
- Guardrails adicionados:
  - `tests/unit/serverRuntimeModules.test.js`
  - `tests/unit/registerRoutesRegistry.test.js`
  - `tests/unit/backendArchitectureGuardrails.test.js`
  - `tests/unit/expressHandlerBridgeBudget.test.js`
  - `tests/unit/expressHandlerBridgeAllowlist.test.js`

## Excecoes aceitas apos o fechamento
1. `api/serverHandlers/*` foi totalmente removido do caminho produtivo e do filesystem do backend.
2. Nao existe mais `expressHandlerBridge.js`; qualquer readocao de adaptador generico quebra os guardrails estruturais.
3. Podas adicionais agora recaem apenas sobre refinamentos internos de modulos, nao sobre compatibilidade historica.
4. Documentacao e guardrails passam a ser a fonte de controle para evitar regressao.

## Direcao canonicamente aceita
- Entrypoint fino em `api/server.js`.
- Startup operacional em `api/runtime/*`.
- Bootstrap de inicializacao em `api/bootstrap/*`.
- Registro de rotas declarativo em `api/app/registerRoutes.js` + `api/app/routeRegistry.js`.
- Wiring local por dominio em `api/composition/*`.
- Adaptadores genericos compartilhados tratados como anti-pattern para este backend.

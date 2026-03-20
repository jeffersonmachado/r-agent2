# Inventario Backend: Rotas e Bootstrap

## Visao geral
- Entry point principal: `api/server.js`
- Tamanho atual: 1611 linhas
- Handlers em `api/serverHandlers`: 69 arquivos
- Handlers wired no dispatcher principal: 69
- Handlers nao wired detectados: 0

## Dispatcher principal (status de extracao)
- Primeira fatia extraida para modulo dedicado: `api/routing/dispatchCoreRoutes.js`.
- Cobertura da fatia: `systemAdmin`, `auth`, `tenant`, `systemGeneration`, `superAdmin`, `onboarding`, `agent`, `audit`, `flowCrud`, `flowExecution`, `conversation`.
- Segunda fatia extraida para modulo dedicado: `api/routing/dispatchPlatformRoutes.js`.
- Cobertura da segunda fatia: `channelAccount`, `queue`, `ticket`, `ai`, `templates`, `config`, `department`, `export`, `aiSuggestion`, `audioTranscription`, `segmentation`, `whatsappTemplate`, `rag`, `configAdmin`, `storefront`, `physicalPublic`, `physicalStation`, `publicToken`.
- Terceira fatia extraida para modulo dedicado: `api/routing/dispatchExtendedRoutes.js`.
- Cobertura da terceira fatia: `webScraping`, `webhooks`, `rpaTests`, `qa`, `devManagement`, `intelligence`, `marketIntelligence`, `accessControl`, `beauty`, `fitness`, `operationsDashboard`, `pbx`, `schedulingSupport`, `voice`, `queueTicket`, `ops`, `executionLedger`, `whatsAppConnection`, `inbox`, `supportDebug`, `automation`, `developerKey`, `marketing`, `order`, `processRuntime`, `publicApi`, `ragDocuments`, `rbac`, `sla`, `solution`, `supervisor`, `task`, `webhook`, `whatsAppIvr`, `whatsAppQrWebhook`.
- Estrategia: registry declarativo com ordem preservada e mesmas dependencias (`deps`) por handler.

## Handlers anteriormente nao wired (ARC-008 concluido)
- `api/serverHandlers/analyticsRoutes.js` agora montado via `api/modules/analytics/routes.js`
- `api/serverHandlers/bulkCampaignsRoutes.js` agora montado via `api/modules/bulk-campaigns/routes.js`
- `api/serverHandlers/quickRepliesRoutes.js` agora montado via `api/modules/quick-replies/routes.js`

## Densidade de rotas por handler (proxy)
Metrica usada: ocorrencias de `method === 'X'`.

- Total de condicoes de metodo em handlers: 492
- Top handlers por densidade:
  - `verticalFitnessRoutes.js`: 18
  - `configAdminRoutes.js`: 18
  - `accessControlRoutes.js`: 17
  - `agentRoutes.js`: 13
  - `pbx/pbxContactCenterRoutes.js`: 12
  - `vertical-beauty/beautyLifecycleRoutes.js`: 10
  - `processRuntimeRoutes.js`: 10
  - `marketingRoutes.js`: 10
  - `intelligenceRoutes.js`: 10

## Hotspots por tamanho
- `api/serverHandlers/system-generation/suggestDescriptionRoute.js`: 348 linhas
- `api/serverHandlers/pbx-core/configurationRoutes.js`: 324 linhas
- `api/serverHandlers/pbx-core/extensionsProvisioningRoutes.js`: 318 linhas
- `api/serverHandlers/config/tenantAiRoutes.js`: 293 linhas
- `api/serverHandlers/vertical-beauty/beautyCustomerRoutes.js`: 287 linhas
- `api/serverHandlers/flow-execution/rpaTestGenerationRoutes.js`: 293 linhas
- `api/serverHandlers/public-system/publicMarketingRoutes.js`: 283 linhas
- `api/serverHandlers/system-generation/contentRoutes.js`: 253 linhas
- `api/serverHandlers/pbx-core/queuesRoutes.js`: 250 linhas
- `api/serverHandlers/flow-execution/flowExecutionRoutes.js`: 244 linhas
- `api/serverHandlers/pbx-core/dialplanRoutes.js`: 237 linhas
- `api/serverHandlers/flow-execution/flowValidationRoutes.js`: 212 linhas
- `api/serverHandlers/system-generation/controlRoutes.js`: 195 linhas
- `api/serverHandlers/vertical-beauty/beautyLifecycleRoutes.js`: 195 linhas
- `api/serverHandlers/rpa-tests/rpaExecutionRoutes.js`: 185 linhas
- `api/serverHandlers/rpa-tests/rpaReplayRoutes.js`: 185 linhas
- `api/serverHandlers/physical-station/physicalStationServiceRoutes.js`: 175 linhas
- `api/serverHandlers/rpa-tests/rpaRecordingsRoutes.js`: 167 linhas
- `api/serverHandlers/config/configValidationRoutes.js`: 164 linhas
- `api/serverHandlers/public-system/publicHealthRoutes.js`: 163 linhas
- `api/serverHandlers/config/configCoreRoutes.js`: 158 linhas
- `api/serverHandlers/flow-execution/flowGenerationRoutes.js`: 173 linhas
- `api/serverHandlers/system-generation/pipelineRoutes.js`: 133 linhas
- `api/serverHandlers/vertical-beauty/beautyRouteHelpers.js`: 135 linhas
- `api/serverHandlers/physical-station/physicalStationQueueRoutes.js`: 128 linhas
- `api/serverHandlers/physical-station/physicalStationSupportRoutes.js`: 108 linhas
- `api/serverHandlers/pbx-core/systemRoutes.js`: 104 linhas
- `api/serverHandlers/config/configRouteUtils.js`: 85 linhas
- `api/serverHandlers/public-system/publicProvisioningRoutes.js`: 81 linhas
- `api/serverHandlers/vertical-beauty/beautyInsightsRoutes.js`: 69 linhas
- `api/serverHandlers/public-system/publicRuntimeRoutes.js`: 61 linhas
- `api/serverHandlers/physical-station/physicalStationHelpers.js`: 45 linhas
- `api/serverHandlers/config/contractsRoutes.js`: 40 linhas
- `api/serverHandlers/configRoutes.js`: 33 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/systemGenerationRoutes.js`: 32 linhas (orquestrador fino)
- `api/serverHandlers/publicSystemRoutes.js`: 31 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/flowExecutionRoutes.js`: 31 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/pbx/pbxCoreRoutes.js`: 26 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/verticalBeautyRoutes.js`: 21 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/physicalStationRoutes.js`: 21 linhas (orquestrador fino) — **DECOMPOSED**
- `api/serverHandlers/rpaTestsRoutes.js`: 20 linhas (orquestrador fino) — **DECOMPOSED**

Observacao:
- Hotspots reduzidos a orquestradores finos (20-33 linhas): `rpaTestsRoutes`, `publicSystemRoutes`, `physicalStationRoutes`, `verticalBeautyRoutes`, `configRoutes`, `systemGenerationRoutes`, `flowExecutionRoutes`, `pbxCoreRoutes`, `pbxRoutes`, `ticketRoutes`, `ragDocumentsRoutes`, `ragRoutes`.
- ONDA 4A (ARC-054) concluida: `flowExecutionRoutes.js` (835 linhas) decompostos em 4 handlers especializados em `flow-execution/` com orquestrador thin.
- ONDA 4B (ARC-055) concluida: `pbx/pbxCoreRoutes.js` (1148 linhas) decomposto em 5 handlers especializados em `pbx-core/` com orquestrador thin.
- ONDA 4C (ARC-056) concluida: `configRoutes.js` (689 linhas) decomposto em 4 handlers especializados em `config/` + util compartilhado, com orquestrador thin.
- ONDA 4D (ARC-057) concluida: `verticalBeautyRoutes.js` (657 linhas) decomposto em 3 handlers especializados em `vertical-beauty/` + helper compartilhado, com orquestrador thin.
- ONDA 4E (ARC-058) concluida: `physicalStationRoutes.js` (644 linhas) decomposto em 3 handlers especializados em `physical-station/` + helper compartilhado, com orquestrador thin.
- ONDA 4F (ARC-059) concluida: `publicSystemRoutes.js` (629 linhas) decomposto em 4 handlers especializados em `public-system/` + helper compartilhado, com orquestrador thin.
- ONDA 4G (ARC-060) concluida: `rpaTestsRoutes.js` (607 linhas) decomposto em 3 handlers especializados em `rpa-tests/` + util compartilhado, com orquestrador thin.
- Padrao reutilizavel consolidado: ondas criticas 4A-4G finalizadas com split por capacidade + orquestrador fino.

## Bootstrap atual (resumo)
Funcao central: `startInitialization()` em `api/server.js`.

Implementacao atual:
- `startInitialization` foi extraido para `api/bootstrap/startInitialization.js` e injetado no entrypoint.

### Etapas de bootstrap
1. Conexao com PostgreSQL (`connect` do Sequelize).
2. Execucao de migrations.
3. Execucao de seed.
4. Definicao de relacionamentos dos models.
5. Inicializacoes best-effort (tenant contexts, flows, auth, queue, departments, quick replies, webhooks, RAG docs, etc.).
6. Inicializacao de providers de IA.

### Startup de runtime/workers (apos `server.listen`)
- Modulo dedicado: `api/runtime/startWorkers.js`.
- Outbound worker.
- Auto return to bot.
- Assignment worker.
- Execution queue worker.
- Vertical scheduler.
- Channel health monitor.

### Shutdown hooks
- Modulo dedicado: `api/runtime/registerShutdownHooks.js`.
- `SIGINT`: stop outbound worker + persistencia de eventos de sessao + exit.
- `SIGTERM`: stop outbound worker + persistencia de eventos de sessao + exit.
- `beforeExit`: persistencia de eventos de sessao.

## Wrappers e camadas auxiliares
- `api/routes/intelligence.js` e `api/routes/marketIntelligence.js` removidos (ARC-016 concluido).
- `api/requestHandler.js` removido; fluxo principal roda em composicao Express no `api/server.js`.

## Conclusao de inventario
- O backend ja possui modularizacao por handler e avancou na separacao de ciclo de vida (bootstrap/runtime/shutdown).
- O roteamento principal foi consolidado em registries declarativos dedicados, mantendo o `server.js` como orquestrador leve e deixando como proximo foco a ampliacao de testes de contrato por grupo de rotas.

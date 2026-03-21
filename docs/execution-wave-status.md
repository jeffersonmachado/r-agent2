# Status de Execucao por Onda

## Ciclo atual
- Ciclo: ONDA 15
- Estado: concluida
- Data de referencia: 2026-03-21

## Entregas concluidas nesta onda
- `api/server.js` reduzido de 962 para 212 linhas.
- `api/app/registerRoutes.js` reduzido de 355 para 210 linhas.
- agregadores `domain-*` e `platform-*` promovidos para composition roots dedicadas no registro central.
- `buildCoreRoutingContext.js`, `buildPlatformRoutingContext.js` e `buildExtendedRoutingContext.js` reduzidos para 63, 60 e 47 linhas via slices por dominio.
- bridges reduzidas de 34 para 0 modulos com a migracao nativa de `public-api`, `support-debug`, `whatsapp-connection`, `whatsapp-ivr`, `whatsapp-qr-webhook`, `queue-ticket`, `execution-ledger`, `frontend-fallback`, `analytics`, `quick-replies`, `access-control`, `voice`, `ops`, `public-system`, `web-scraping`, `qa`, `operations-dashboard`, `dev-management`, `intelligence`, `market-intelligence`, `rpa-tests`, `webhooks`, `bulk-campaigns`, `channel-webhook`, `domain-identity`, `domain-flow`, `domain-admin`, `platform-admin`, `platform-public`, `platform-content`, `rag-documents`, `ticket`, `vertical` e `pbx`.
- Novos modulos criados:
  - `api/bootstrap/systemAdminBootstrap.js`
  - `api/runtime/startServerRuntime.js`
  - `api/runtime/processManager.js`
  - `api/runtime/flowRuntimeState.js`
  - `api/app/routeRegistry.js`
  - 10 novas composition roots locais para routers que ainda tinham wiring inline
- Guardrails novos:
  - `tests/unit/serverRuntimeModules.test.js`
  - `tests/unit/registerRoutesRegistry.test.js`
  - `tests/unit/backendArchitectureGuardrails.test.js`
  - `tests/unit/expressHandlerBridgeBudget.test.js`
  - `tests/unit/expressHandlerBridgeAllowlist.test.js`

## Validacao executada
- `node --check api/server.js`
- `node --check api/app/registerRoutes.js`
- `node --check` nos novos modulos de runtime/bootstrap/composition
- `npm exec -- jest --runTestsByPath api/server.test.js tests/unit/serverRuntimeModules.test.js tests/unit/registerRoutesRegistry.test.js tests/unit/backendArchitectureGuardrails.test.js tests/unit/expressHandlerBridgeBudget.test.js tests/unit/expressHandlerBridgeAllowlist.test.js tests/unit/platformResidualEliminationWiring.test.js tests/unit/ragDocumentsModuleRoutes.test.js tests/unit/ticketRoutes.test.js tests/unit/verticalBeautyRoutes.test.js --runInBand --no-coverage`
- Resultado consolidado do gate final: 10 suites, 61 testes, 100% pass

## Estado arquitetural apos a onda
- `server.js` deixou de ser hotspot operacional.
- `registerRoutes.js` virou registrador declarativo.
- Nenhum modulo em `api/modules/*` ainda importa `serverHandlers`.
- O bridge compartilhado foi removido; o guardrail agora trava budget zero para `mountExpressHandler` e `createExpressHandlerMiddleware`.
- `api/serverHandlers/*` foi removido; nao ha mais arquivos produtivos ou caminho canonico passando por esse diretorio.
- O gate final de fechamento arquitetural foi concluido.

## Proxima onda habilitada
- Nao ha nova onda estrutural obrigatoria aberta para o backend.

## Checkpoint frontend (2026-03-21)
- `frontend/src/pages/FlowEditorPage.jsx`: 929 linhas (extraidos overlays, painel direito, paleta, canvas, toolbar, hooks de zoom, exportacao, selecao/layout, busca/navegacao, I/O de arquivos, manutencao/replay, controles de UI, clipboard, canvas/historico, workflow do editor, ciclo de vida do fluxo, interacao de no/historico e realtime WebSocket; sem handlers locais relevantes restantes).
- `frontend/src/pages/GenerateSystemPage.jsx`: 863 linhas (extraidos cluster de realtime do pipeline, configuracao visual de labels/mensagens do pipeline, logica de validacao do formulario, montagem de payload, atualizacao de status/detalhes do pipeline, logica de rate limit, preenchimento automatico do objetivo inicial, metadados de sugestao de descricao, toast global de erro deduplicado, automacao do modo bootstrap, protecao de autenticacao/redirecionamento, sincronizacao de estado de execucao para ref, blocos de reset UI/validacao/payload e montagem completa do contexto do orquestrador para modulos dedicados).
- Novos modulos ONDA 15:
  - `frontend/src/pages/flow-editor/useFlowEditorBpmnZoom.js` (254 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorExport.js` (348 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorSelectionLayout.js` (288 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorSearchNavigation.js` (235 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorFileIO.js` (497 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorMaintenance.js` (202 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorUiControls.js` (104 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorClipboard.js` (143 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorCanvasHistory.js` (419 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorWorkflowActions.js` (313 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorLifecycle.js` (551 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorNodeInteraction.js` (283 linhas)
  - `frontend/src/pages/flow-editor/useFlowEditorRealtimeStatus.js` (61 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemPipelineRealtime.js` (47 linhas)
  - `frontend/src/pages/generate-system/generateSystemPipelineUiConfig.js` (105 linhas)
  - `frontend/src/pages/generate-system/generateSystemValidationUtils.js` (105 linhas)
  - `frontend/src/pages/generate-system/generateSystemPayloadUtils.js` (49 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemPipelineDetailsUpdater.js` (106 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemRateLimit.js` (62 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemInitialFlowObjective.js` (50 linhas)
  - `frontend/src/pages/generate-system/generateSystemDescriptionSuggestionUtils.js` (11 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemErrorToast.js` (15 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemBootstrapMode.js` (33 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemAuthGuard.js` (9 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemExecutingRefSync.js` (7 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemInitialFlowUiReset.js` (26 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemValidationGate.js` (48 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemPayloadBuilder.js` (59 linhas)
  - `frontend/src/pages/generate-system/useGenerateSystemOrchestratorContext.js` (173 linhas)
- Validacao: `cd frontend && npm run build` concluido sem erros (944 modulos).

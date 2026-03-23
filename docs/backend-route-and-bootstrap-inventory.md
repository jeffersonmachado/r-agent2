# Inventario Backend: Rotas e Bootstrap

## Visao geral (2026-03-21)
- Entry point principal: `api/server.js`
- Tamanho atual: 212 linhas
- Registro central de rotas: `api/app/registerRoutes.js`
- Tamanho atual: 210 linhas
- Manifesto declarativo de ordem: `api/app/routeRegistry.js`
- Composition roots em `api/composition/`: 34 diretorios
- Modulos bridgeados que ainda importam `serverHandlers`: 0
- Guardrail de budget para bridges: `tests/unit/expressHandlerBridgeBudget.test.js`
- Guardrail de coercoes compartilhadas em hotspots: `tests/unit/defensiveCoercion.shared.test.js`
- Builders de contexto central apos decomposicao:
  - `api/composition/core/buildCoreRoutingContext.js` + slices de `core/*Deps.js`
  - `api/composition/platform/buildPlatformRoutingContext.js` + slices de `platform/*Deps.js`
  - `api/composition/extended/buildExtendedRoutingContext.js` + slices de `extended/*Deps.js`

## Bootstrap e runtime canonicos
- Bootstrap:
  - `api/bootstrap/startInitialization.js`
  - `api/bootstrap/systemAdminBootstrap.js`
- Runtime:
  - `api/runtime/startServerRuntime.js`
  - `api/runtime/startWorkers.js`
  - `api/runtime/registerShutdownHooks.js`
  - `api/runtime/processManager.js`
  - `api/runtime/flowRuntimeState.js`

## Atualizacao 2026-03-22
- `api/server.js` passou a reutilizar `requireTenant` compartilhado (`api/composition/shared/requireTenant.js`) e removeu duplicacao local.
- `api/utils/defensiveCoercion.js` foi introduzido como utilitario canonico para `safeToString`, `safeTrim`, `safeTrimLower`, `safeErrorMessage` e `safeGet`.
- Servicos migrados para helper compartilhado nesta onda:
  - `api/services/rpaService.js`
  - `api/services/ragDocumentsService.js`
  - `api/services/flowGeneratorService.js`
  - `api/services/tenantService.js`
  - `api/services/queueService.js`
  - `api/services/rpaTestGeneratorService.js`
  - `api/services/generationOrchestrator.js`
  - `api/services/ragService.js`

## O que saiu do entrypoint neste ciclo
- startup principal (`require.main`, `listen`, `startWorkers`)
- bootstrap do `systemadmin`
- cache/estado de flows e session events
- deteccao de process manager
- helpers mortos e no-ops historicos

## O que saiu de registerRoutes neste ciclo
- `buildDeps` inline para:
  - `queue-ticket`
  - `ops`
  - `execution-ledger`
  - `support-debug`
  - `public-api`
  - `channel-webhook`
  - `whatsapp-connection`
  - `whatsapp-ivr`
  - `whatsapp-qr-webhook`
  - `frontend-fallback`
- sequencia aberta de `app.use(...)` substituida por route registry declarativo
- wiring direto dos agregadores `domain-*` e `platform-*`, agora encapsulado em composition roots especificas

## Bridges residuais explicitas
- Ponte compartilhada: removida.
- Estado: `tests/unit/expressHandlerBridgeAllowlist.test.js` agora exige budget zero para `mountExpressHandler` e `createExpressHandlerMiddleware`.
- Reducao recente: `ticket`, `vertical` e `pbx` deixaram de depender de `serverHandlers`, somando-se a `platform-content`, `rag-documents` e aos cortes anteriores.
- Caminho legado removido:
  - `api/serverHandlers/*` nao existe mais
  - nao restam wrappers, handlers ou arquivos produtivos nesse caminho
- Regra atual: novos routers devem montar handlers localmente, sem bridge generico compartilhado.
- Regra canonica atual: nenhum arquivo do backend deve reintroduzir imports ou diretorio `serverHandlers`.

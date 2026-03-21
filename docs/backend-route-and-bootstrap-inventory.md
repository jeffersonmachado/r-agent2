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

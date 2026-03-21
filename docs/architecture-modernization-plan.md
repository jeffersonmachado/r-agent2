# Plano de Modernizacao Arquitetural

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

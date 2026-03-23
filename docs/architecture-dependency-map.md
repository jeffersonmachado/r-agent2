# Mapa de Dependencias Arquiteturais

## Atualizacao 2026-03-22
- Dependencias estruturais de servidor/roteamento continuam estabilizadas.
- Dependencias internas de service ainda concentram risco em arquivos de alta fan-in.
- Hotspots atuais de acoplamento:
  - `api/services/queueService.js`
  - `api/services/ragDocumentsService.js`
  - `api/services/ragService.js`
  - `api/services/generationOrchestrator.js`
  - `api/core/process-runtime/processRuntimeService.js`
- Acoplamentos a reduzir na proxima onda:
  - agregacao excessiva de dependencias em services com 1k+ linhas;
  - concentracao de regras HTTP em `handle*Routes` extensos dentro de `api/modules/*`.

## Snapshot estrutural atual (2026-03-21)
- `api/server.js` deixou de ser o grande concentrador operacional; nao ha mais modulos em `api/modules/*` importando `serverHandlers`.
- `api/app/registerRoutes.js` agora depende de `api/app/routeRegistry.js` e de composition roots locais, em vez de carregar builders inline.
- `api/runtime/flowRuntimeState.js` concentra o estado compartilhado de flows/sessions antes espalhado no entrypoint.
- `api/runtime/startServerRuntime.js` e `api/bootstrap/systemAdminBootstrap.js` absorveram responsabilidades antes presas a `api/server.js`.

## Hotspots atuais do backend
1. Guardrails para impedir a reintroducao de bridge compartilhado entre routers e handlers.
2. Evitar regressao estrutural que recrie atalhos centrais em `server.js` ou `registerRoutes.js`.

## Bridges residuais reais
- Nao existe mais ponte compartilhada canonica entre routers e handlers.
- Nao existe `legacyExpressBridge.js` no codigo atual.
- Modulos bridgeados remanescentes:
  - nenhum em `api/modules`

## Direcao de reducao de acoplamento
- Tratar qualquer reintroducao de `api/serverHandlers/*` como regressao arquitetural.
- Encapsular wiring por dominio e evitar regressao para imports diretos de `serverHandlers` fora da pasta legada.
- Manter o route registry declarativo e o entrypoint fino como restricoes arquiteturais.

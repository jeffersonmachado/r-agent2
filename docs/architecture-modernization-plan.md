# Plano de Modernizacao Arquitetural

## Objetivo
Modernizar backend e frontend de forma incremental, sem reescrita total, preservando contratos publicos e mantendo deploy seguro em cada onda.

## Escopo
- Backend: reduzir concentracao de responsabilidades em `api/server.js` e evoluir para modulo de bootstrap + modulo de roteamento.
- Frontend: consolidar componentes canonicos para grid, dashboard e CRUD.
- Legado: remover sobreposicoes, wrappers e variantes nao roteadas somente apos fase de convivencia controlada.

## Estado atual (snapshot 2026-03-20, fechamento arquitetural)
- `api/server.js`: 962 linhas como entrypoint unico, funcional e estavel.
- `api/app/registerRoutes.js`: 355 linhas, sem builders centralizados relevantes.
- Builders centralizados em `registerRoutes.js`: 0.
- Composition roots ativos em `api/composition/`: `tenant`, `ticket`, `rag`, `auth`, `pbx`, `vertical`, `webhooks`, `public-system`, `operations-dashboard`, `qa`, `voice`, `web-scraping`, `rpa-tests`, `dev-management`, `intelligence`, `market-intelligence`, `access-control`, `analytics`, `bulk-campaigns`, `quick-replies` (+ `core`, `platform`, `extended` apenas para contexto compartilhado).
- Bridge residual explicito: `api/modules/shared/legacyExpressBridge.js` centraliza a ponte remanescente e documentada para handlers ainda nao reescritos em modulo nativo.
- Frontend: `PlatformGrid` e o unico grid ativo; `DataGrid` foi removido do frontend em 2026-03-20.
- Dashboard canonico: `frontend/src/pages/DevDashboardPage.jsx`; exports compartilhados de dashboard passam por `frontend/src/modules/dashboard-base/index.js`.

## Principios de execucao
- Nao quebrar contratos HTTP existentes.
- Extrair com feature parity (sem mudar comportamento observavel na mesma onda).
- Validar a cada onda com checagem tecnica minima.
- Definir componente/camada canonica antes de remover legado.
- Priorizar mudancas de baixo risco e alta reducao de acoplamento.

## Ondas (macro)

### ONDA 1 - Inventario e diagnostico (concluida neste ciclo)
- Inventario backend: bootstrap, roteamento, handlers, workers, wrappers.
- Inventario frontend: grids, dashboards, CRUD e variantes legacy.
- Mapa de dependencia, riscos e backlog inicial.

### ONDA 2 - Extracoes seguras de `api/server.js`
- Extrair bootstrap para `api/bootstrap/*` (apenas organizacao interna).
- Extrair pipeline de startup de workers para `api/runtime/*`.
- Manter `createServer()` e `requestHandler()` com mesma semantica de resposta.

### ONDA 3 - Roteamento incremental (concluida)
- Composer de rotas por dominio introduzido no runtime Express.
- Sequencias legacy foram migradas para routers modulares e registradores declarativos.
- Wiring protegido por testes de contrato e suites de cutover.

### ONDA 4 - Modulos de dominio backend (em execucao continua)
- Consolidacao de dominios de alto churn em modulos/composition roots dedicados.
- Reducao progressiva de dependencias cruzadas e builders centralizados em `registerRoutes.js`.
- Wrappers redundantes removidos; foco atual em extrair wiring de dominio restante para `api/composition/<domain>/index.js`.

### ONDA 5 - Grid canonico frontend (concluida)
- `platform-grid` foi consolidado como base canonica para grids.
- As paginas prioritarias foram migradas.
- `DataGrid` foi aposentado e removido do frontend ativo.

### ONDA 6 - Dashboard/base page canonica (concluida)
- Componentes compartilhados de dashboard existem em `frontend/src/components/DashboardBase/*`.
- O barrel canonico `frontend/src/modules/dashboard-base/index.js` centraliza os exports reutilizaveis.
- `DevDashboardPage.jsx` segue como dashboard operacional canonico e modularizado.

### ONDA 7 - Limpeza de legado (concluida)
- Variantes nao usadas do dashboard de desenvolvimento foram removidas.
- Codigo morto de grid foi removido.
- Bridges residuais ficaram reduzidas a uma ponte explicita e documentada.

## Criterios de passagem entre ondas
- Build/test baseline sem regressao funcional relevante.
- Rotas criticas respondendo 2xx/4xx esperados.
- Sem aumento de arquivos orphan/duplicados.
- Evidencias publicadas em `docs/execution-wave-status.md`.

## Primeiras extracoes recomendadas (baixo risco)
1. Extrair bloco de inicializacao (`startInitialization`) para `api/bootstrap/startInitialization.js` mantendo assinatura atual.
2. Extrair startup de workers (outbound/assignment/execution queue/vertical scheduler/channel health) para `api/runtime/startWorkers.js`.
3. Extrair shutdown hooks (`SIGINT`/`SIGTERM`/`beforeExit`) para `api/runtime/registerShutdownHooks.js`.

## Fechamento atual
1. Backend principal fechado: `registerRoutes.js` deixou de ser hotspot estrutural e a composicao por dominio esta completa.
2. Frontend principal fechado: `PlatformGrid` e o unico grid ativo, `CrudPageBase` cobre os fluxos CRUD principais e dashboards compartilham um path canonico de base.
3. Legado residual ficou restrito a pontos explicitos, documentados e sem ambiguidade operacional relevante.

## Fora de escopo imediato
- Reescrever backend para outro framework HTTP em bloco unico.
- Troca ampla de design system frontend na mesma janela das extracoes arquiteturais.
- Mudancas de contrato de API sem camada de compatibilidade.

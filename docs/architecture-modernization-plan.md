# Plano de Modernizacao Arquitetural

## Objetivo
Modernizar backend e frontend de forma incremental, sem reescrita total, preservando contratos publicos e mantendo deploy seguro em cada onda.

## Escopo
- Backend: reduzir concentracao de responsabilidades em `api/server.js` e evoluir para modulo de bootstrap + modulo de roteamento.
- Frontend: consolidar componentes canonicos para grid, dashboard e CRUD.
- Legado: remover sobreposicoes, wrappers e variantes nao roteadas somente apos fase de convivencia controlada.

## Estado atual (baseline ONDA 1)
- `api/server.js`: 2674 linhas.
- `api/serverHandlers/*.js`: 69 arquivos, 66 wired em `server.js`, 3 nao wired.
- Dependencias locais no backend (`api/**`): 1729 arestas entre 553 arquivos.
- Dependencias locais no frontend (`frontend/src/**`): 1086 arestas entre 430 arquivos.
- Paginas frontend (`frontend/src/pages/**/*.jsx`): 91.
- Paginas importadas em `frontend/src/main.jsx`: 71.
- Variantes de DevDashboard: 3 (`.jsx`, `.refactored.jsx`, `.jsx.backup`).

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

### ONDA 3 - Roteamento incremental
- Introduzir composer de rotas por dominio sem trocar stack HTTP.
- Substituir sequencia longa de `await handle*Routes(...)` por registry ordenado e testavel.
- Cobrir wiring por testes de contrato HTTP.

### ONDA 4 - Modulos de dominio backend
- Consolidar dominios de alto churn (PBX, ticket, RAG docs, tenant) com fronteiras explicitas.
- Reduzir dependencias cruzadas handler->service utilitarias.
- Evoluir wrappers `api/routes/*` para camada clara (ou remover se redundantes).

### ONDA 5 - Grid canonico frontend
- Definir `platform-grid` como base canonica para novos CRUDs.
- Criar adapter para migracao progressiva de usos atuais de `DataGrid`.
- Migrar paginas prioritarias (PBX family + marketplace/solutions).

### ONDA 6 - Dashboard/base page canonica
- Criar base reutilizavel para filtros, cards, estados de loading/erro/empty.
- Aplicar primeiro em dashboards com maior duplicacao de padrao.
- Manter compatibilidade visual e de navegacao.

### ONDA 7 - Limpeza de legado
- Remover variantes nao usadas (`.backup`, `.refactored`) apos congelamento.
- Remover wrappers sem valor e codigo morto identificado nas ondas anteriores.
- Registrar changelog de remocoes e plano de rollback.

## Criterios de passagem entre ondas
- Build/test baseline sem regressao funcional relevante.
- Rotas criticas respondendo 2xx/4xx esperados.
- Sem aumento de arquivos orphan/duplicados.
- Evidencias publicadas em `docs/execution-wave-status.md`.

## Primeiras extracoes recomendadas (baixo risco)
1. Extrair bloco de inicializacao (`startInitialization`) para `api/bootstrap/startInitialization.js` mantendo assinatura atual.
2. Extrair startup de workers (outbound/assignment/execution queue/vertical scheduler/channel health) para `api/runtime/startWorkers.js`.
3. Extrair shutdown hooks (`SIGINT`/`SIGTERM`/`beforeExit`) para `api/runtime/registerShutdownHooks.js`.

## Fora de escopo imediato
- Reescrever backend para outro framework HTTP em bloco unico.
- Troca ampla de design system frontend na mesma janela das extracoes arquiteturais.
- Mudancas de contrato de API sem camada de compatibilidade.

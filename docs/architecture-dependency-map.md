# Mapa de Dependencias Arquiteturais

## Fonte de dados
Levantamento estatico por imports/requires locais (`api/**` e `frontend/src/**`).

## Snapshot estrutural atual (2026-03-20)
- Hotspot backend principal deixou de ser apenas `api/server.js`; `api/app/registerRoutes.js` caiu para 355 linhas e sem builders centralizados.
- `api/server.js` permanece como entrypoint estavel em 962 linhas com composicao Express consolidada.
- Composition roots de dominio cobrem todos os blocos antes montados por `build*RouteDeps` no registro central.
- Builders centralizados em `registerRoutes.js` foram reduzidos de 17 para 0.
- `api/modules/shared/legacyExpressBridge.js` e a unica ponte residual explicita de backend e esta documentada como excecao transitiva.
- `frontend/src/modules/dashboard-base/index.js` centraliza os exports compartilhados de dashboard.
- `DataGrid` foi removido do frontend; `PlatformGrid` e o unico grid ativo.

Observacao:
- As metricas de fan-in/fan-out abaixo permanecem como baseline historico de inventario estatico; o plano corrente prioriza o hotspot real observado no wiring atual (`registerRoutes.js`).

## Backend (`api/**`)
- Arquivos analisados: 553
- Arestas locais: 1729
- Ponto de maior fan-out: `api/server.js` (173 referencias locais)

### Top fan-out (origem -> quantidade)
- `api/server.js`: 173
- `api/db/models/index.js`: 109
- `api/serverHandlers/pbxRoutes.js`: 59
- `api/services/messageProcessor.js`: 35
- `api/services/pipelineOrchestrator.js`: 23
- `api/serverHandlers/ragDocumentsRoutes.js`: 22

### Top fan-in (alvo <- quantidade)
- `api/db/sequelize.js`: 171
- `api/db/models/index.js`: 114
- `api/utils/logger.js`: 99
- `api/db/migrations-helper.js`: 58
- `api/db/models/helpers.js`: 36
- `api/utils/config.js`: 28

### Conclusoes backend
- `api/server.js` eh o principal concentrador de composicao e ciclo de vida.
- Camada de banco e utilitarios (`sequelize`, `models`, `logger`) formam eixos de alto impacto.
- Os antigos mega-handlers de entrada (`pbxRoutes.js`, `ragDocumentsRoutes.js`, `ticketRoutes.js`, `ragRoutes.js`) foram reduzidos a orquestradores finos.
- Os hotspots atuais concentram-se mais nos handlers especializados, com destaque para os clusters `public-system/*`, `rpa-tests/*`, `pbx-core/*`, `config/*`, `vertical-beauty/*` e `system-generation/*` (com `suggestDescriptionRoute.js` como maior bloco do dominio).

## Frontend (`frontend/src/**`)
- Arquivos analisados: 430
- Arestas locais: 1086
- Maior fan-out: `frontend/src/main.jsx` (83 imports locais)

### Top fan-out (origem -> quantidade)
- `frontend/src/main.jsx`: 83
- `frontend/src/pages/FlowEditorPage.jsx`: 42
- `frontend/src/pages/SupportPage.jsx`: 24
- `frontend/src/pages/GenerateSystemPage.jsx`: 23
- `frontend/src/pages/crm/CrmPage.jsx`: 17

### Top fan-in (alvo <- quantidade)
- `frontend/src/utils/logger.js`: 106
- `frontend/src/api/client.js`: 83
- `frontend/src/styles/Button.jsx`: 72
- `frontend/src/components/Toast.jsx`: 67
- `frontend/src/hooks/useRouter.js`: 63

### Conclusoes frontend
- `main.jsx` continua concentrando roteamento e permanece como principal hotspot estrutural do frontend.
- `api/client.js` e `logger.js` sao dependencias transversais centrais.
- `frontend/src/modules/dashboard-base/index.js` e `frontend/src/modules/crud-base/index.js` reduzem ambiguidade nos dois shells canonicos compartilhados.
- Paginas grandes continuam concentrando regra e estado (ex.: `GenerateSystemPage.jsx`, `SupportPage.jsx`, `RAGDocumentsPage.jsx`, `OperationsDashboardPage.jsx`).

## Pontos de acoplamento critico
1. Bootstrap e roteamento central no backend (`api/server.js`).
2. Roteamento central no frontend (`frontend/src/main.jsx`).
3. Handlers backend de alto volume (PBX/RAG/Ticket/Tenant).
4. Paginas frontend de alto volume de codigo e logica local.

## Direcao de reducao de acoplamento
- Backend: migrar composicao para modulos de bootstrap/runtime/registry mantendo `server.js` como entrypoint leve.
- Frontend: mover de roteador gigantesco para registry declarativo e reduzir logica em paginas grandes com hooks/sections.
- Domain-first: atacar hotspots por dominio com extrações pequenas e validacao por contrato.

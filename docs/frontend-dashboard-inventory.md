# Inventario Frontend: Dashboards

## Dashboard files detectados
- `frontend/src/pages/DashboardPage.jsx`
- `frontend/src/pages/OperationsDashboardPage.jsx`
- `frontend/src/pages/ChatHumanoDashboardPage.jsx`
- `frontend/src/pages/QueuePhysicalDashboardPage.jsx`
- `frontend/src/pages/DevDashboardPage.jsx`
- `frontend/src/pages/crm/CrmDashboardPage.jsx`
- `frontend/src/pages/crm/AnalyticsDashboard.jsx`

Observacao: `frontend/src/pages/OperationsDashboardPage.test.jsx` foi detectado por padrao de nome, mas eh arquivo de teste.

## Rotas de dashboard em `frontend/src/main.jsx`
Componentes importados e roteados diretamente no roteador principal:
- `DashboardPage`
- `OperationsDashboardPage`
- `AnalyticsPage` (pagina analitica, nao arquivo com sufixo Dashboard)
- `ChatHumanoDashboardPage`
- `QueuePhysicalDashboardPage`
- `SupervisorPage` (dashboard funcional sem sufixo no nome do arquivo)
- `CrmDashboardPage`
- `DevDashboardPage`

## Canonico vs paralelo
- Canonico atual de desenvolvimento: `frontend/src/pages/DevDashboardPage.jsx` (importado em `main.jsx`).
- Variantes paralelas removidas neste ciclo: `.refactored.jsx` e `.jsx.backup`.

Checkpoint 2026-03-20:
- `frontend/src/main.jsx` segue importando exclusivamente `DevDashboardPage` como dashboard de desenvolvimento.
- `frontend/src/modules/dashboard-base/index.js` passa a ser o ponto canonico de export para `DashboardFeatureGrid`, `DashboardKpiCard` e `DashboardSection`.
- `frontend/src/pages/ChatHumanoDashboardPage.jsx` e `frontend/src/pages/QueuePhysicalDashboardPage.jsx` ja consomem o modulo canonico novo.
- `frontend/src/pages/DevDashboardPage.jsx` continua modularizado em `components/DevDashboard/*`.

## Padroes comuns observados
- Dashboards "hub" ja compartilham cards e sections por meio de `components/DashboardBase/*`, agora expostos tambem por `modules/dashboard-base`.
- Estados de loading/erro/empty ainda permanecem inline nos hotspots maiores.
- O acoplamento mais relevante restante esta em `DashboardPage.jsx` e `OperationsDashboardPage.jsx`.

## Oportunidades de consolidacao
1. Continuar extraindo `DashboardPage.jsx` para a base canonica de dashboard.
2. Decompor `OperationsDashboardPage.jsx` em secoes/hooks menores mantendo o contrato atual.
3. Padronizar filter bars, refresh e section states sobre o modulo `modules/dashboard-base`.
4. Manter `DevDashboardPage.jsx` e `components/DevDashboard/*` como trilha canonica para dashboards operacionais mais complexos.

## Prioridade de migracao sugerida
1. `DashboardPage.jsx` (hub de navegacao com grande superficie de links).
2. `OperationsDashboardPage.jsx` (alto volume de estado e multiplas abas).
3. `crm/CrmDashboardPage.jsx` e `crm/AnalyticsDashboard.jsx` para convergencia de CRM.

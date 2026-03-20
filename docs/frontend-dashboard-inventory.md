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

## Padroes comuns observados
- Blocos repetidos de filtros + cards + tabelas/listas + toasts/alerts.
- Estados de loading/erro/empty implementados por pagina (sem base unificada).
- Acoplamento direto pagina->API em boa parte dos dashboards.

## Oportunidades de consolidacao
1. Criar `DashboardBase` com layout, cabecalho e secoes reutilizaveis.
2. Extrair componentes comuns para KPI cards, filter bars e section states.
3. Padronizar estrategia de polling/refresh e erro por aba/secao.
4. Continuar convergencia do dashboard canonico sobre a nova base (`DevDashboardLayout`, `DevDashboardSection`, `DevDashboardKpiCard`).

## Prioridade de migracao sugerida
1. `OperationsDashboardPage.jsx` (alto volume e multipla responsabilidade).
2. `DashboardPage.jsx` (hub de navegacao com grande superficie de links).
3. `DevDashboardPage.jsx` (continuar extracao de secoes apos consolidacao canonica).

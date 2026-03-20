# Inventario Frontend: CRUD

## Panorama
- Paginas em `frontend/src/pages/**/*.jsx`: 91
- Paginas importadas no roteador principal (`main.jsx`): 71
- Paginas com forte sinal de operacao CRUD/API-driven (heuristica por imports/chamadas de API): 70

## Paginas de maior tamanho (proxy de complexidade)
- `GenerateSystemPage.jsx`: 6267 linhas
- `SupportPage.jsx`: 5418 linhas
- `RAGDocumentsPage.jsx`: 4888 linhas
- `FlowEditorPage.jsx`: 4432 linhas
- `PbxPage.jsx`: 4128 linhas
- `ConfigPage.jsx`: 2228 linhas
- `AnalyticsPage.jsx`: 1699 linhas
- `OperationsDashboardPage.jsx`: 1518 linhas

## Clusters de CRUD

### Cluster PBX
- `PbxPage.jsx`
- `PbxModulePage.jsx`
- `PbxRoutesPage.jsx`
- `PbxExtensionsPage.jsx`
- `PbxTrunksPage.jsx`

Sinais:
- Uso relevante de `DataGrid`.
- Alto volume de formularios/acoes por linha.
- Alto potencial de ganho com `CrudBase + Grid canonico`.

### Cluster Config/Admin
- `ConfigPage.jsx`
- `TenantsPage.jsx`
- `AgentsPage.jsx`
- `AccessControlPage.jsx`
- `SsoScimPage.jsx`
- `BackupPage.jsx`

Sinais:
- Mix de tabelas e formularios com padroes repetidos de loading/erro/salvar.

### Cluster Atendimento/Conhecimento
- `SupportPage.jsx`
- `QuickRepliesPage.jsx`
- `FaqManagementPage.jsx`
- `RAGDocumentsPage.jsx`
- `TicketMaintenancePage.jsx`

Sinais:
- Alto fluxo operacional e acoplamento com APIs.
- Necessidade de padronizar tabela/lista, filtros e acoes de massa.

### Cluster CRM
- `crm/CrmDashboardPage.jsx` + paginas `crm/*`

Sinais:
- Dominio com varias entidades e potencial de base reutilizavel de CRUD por entidade.

## Lacunas atuais
- Sem base CRUD unica para tabela + filtros + formulario + estado.
- Variação de UX entre paginas com comportamento parecido.
- Repeticao de codigo para feedback de erro/sucesso.

## Proposta de evolucao
1. Criar `CrudPageBase` (layout, filtros, tabela, paginacao, estado).
2. Criar hooks padrao (`useCrudList`, `useCrudForm`) para reduzir boilerplate.
3. Migrar por dominio, iniciando por paginas com menor acoplamento cruzado.
4. Consolidar padrao de toasts e mensagens de erro por operacao.

## Candidatos para piloto de `CrudPageBase`
1. `NodeMarketplacePage.jsx`
2. `SolutionsPage.jsx`
3. `QuickRepliesPage.jsx`

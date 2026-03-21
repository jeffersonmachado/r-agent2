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
- Uso consolidado de `PlatformGrid` nas paginas principais do cluster.
- Alto volume de formularios/acoes por linha permanece como fonte de complexidade.
- Alto potencial de ganho com `CrudBase + Grid canonico` para reduzir boilerplate de estado e operacoes.

### Cluster Config/Admin
- `ConfigPage.jsx` — **migrado** para `CrudPageBase` (ARC-087; sub-abas e fluxo interno preservados)
- `TenantsPage.jsx` — **migrado** para `CrudPageBase` + `useCrudFilters` (ARC-081)
- `AgentsPage.jsx` — **migrado** para `CrudPageBase` + `useCrudFilters` (ARC-081)
- `AccessControlPage.jsx` — **migrado** para `CrudPageBase` (ARC-082; filtros URL-sync mantidos em useState local)
- `SsoScimPage.jsx` — **migrado** para `CrudPageBase` (ARC-082)
- `BackupPage.jsx` — **migrado** para `CrudPageBase` (ARC-082)

Sinais:
- Zero `support-page` inline no cluster Config/Admin.
- Mix de tabelas e formularios com padroes repetidos de loading/erro/salvar — mitigado com hooks canonicos ONDA 10.

### Cluster Atendimento/Conhecimento
- `SupportPage.jsx` — **migrado** para `CrudPageBase` (ARC-090; shell raiz)
- `QuickRepliesPage.jsx` — **migrado** para `CrudPageBase` (ARC-080; guard authLoading corrigido ONDA 10)
- `FaqManagementPage.jsx` — **migrado** para `CrudPageBase` (ARC-089)
- `RAGDocumentsPage.jsx` — **migrado** para `CrudPageBase` (ARC-090; shell raiz com `hideHeader`)
- `TicketMaintenancePage.jsx` — **migrado** para `CrudPageBase` (ARC-089)

Sinais:
- Alto fluxo operacional e acoplamento com APIs.
- Necessidade de padronizar tabela/lista, filtros e acoes de massa.

### Cluster CRM
- `crm/CrmDashboardPage.jsx` + paginas `crm/*`

Sinais:
- Dominio com varias entidades e potencial de base reutilizavel de CRUD por entidade.

## Estado de fechamento
- Os fluxos CRUD principais de Config/Admin e Atendimento/Conhecimento ja usam `CrudPageBase`.
- `useCrudList`, `useCrudFilters`, `useCrudForm` e `crudFeedback` cobrem o contrato canonico do modulo.
- Os remanescentes grandes estao concentrados em dominios especializados e nao bloqueiam o fechamento arquitetural do frontend.
- A proxima frente e reducao incremental de hotspots internos, nao criacao de uma nova base CRUD.

## Lacunas atuais
- Hotspots de volume ainda existem em paginas especializadas como `PbxPage.jsx`, `GenerateSystemPage.jsx` e `AnalyticsPage.jsx`.
- Ha variacao de UX em paginas fora dos fluxos CRUD principais.
- Extracoes futuras devem mirar reducao de tamanho/estado, nao reabertura do padrao canonico.

## Proposta de evolucao
1. Manter `CrudPageBase` como shell obrigatorio para novos CRUDs administrativos e operacionais.
2. Expandir `useCrudList`/`useCrudForm` apenas quando houver ganho real de simplificacao.
3. Priorizar decomposicao de hotspots internos em paginas ja migradas antes de novas bases visuais.
4. Preservar guardrails de wiring para evitar regressao ao wrapper `support-page` inline nos fluxos principais.

## Progresso de piloto `CrudPageBase`

### ONDA 9 (concluida)
- Base criada em `frontend/src/modules/crud-base/CrudPageBase.jsx`.
- Hook inicial de filtros criado em `frontend/src/modules/crud-base/hooks/useCrudFilters.js`.
- `QuickRepliesPage.jsx` migrada (ARC-080); guard authLoading corrigido na ONDA 10.
- `TenantsPage.jsx` migrada: `useCrudFilters`, `CrudPageBase` com `actions` (ARC-081).
- `AgentsPage.jsx` migrada: `useCrudFilters`, `CrudPageBase` com `actions` (ARC-081).
- `AccessControlPage.jsx`, `BackupPage.jsx`, `SsoScimPage.jsx` migradas (ARC-082).
- Validacao: `cd frontend && npm run build` concluido sem erros (849 modulos).

### ONDA 10 (concluida)
- `useCrudList.js` criado: fetch padronizado com `loading/error/reload` (ARC-083).
- `useCrudForm.js` criado: estado de formulario com `setField/resetForm/isDirty` (ARC-084).
- `crud-base/index.js` exporta 4 membros: `CrudPageBase`, `useCrudFilters`, `useCrudList`, `useCrudForm`.
- Suites Vitest para modulo `crud-base`: 3 suites, 29/29 testes (ARC-086).
- Suites Jest de wiring/guardrail: 2 suites, 10/10 testes (ARC-085).
- Validacao: `jest tests/unit/` 10/10 pass + `vitest run` 29/29 pass.

### ONDA 11 (concluida)
- `useCrudList` evoluido com `params`, `loadOnMount` e `reloadOnParamsChange` (ARC-088).
- testes Vitest do hook atualizados: 18/18 passando (`useCrudList.useCrudForm.test.js`).
- `TenantsPage.jsx` adotou `useCrudList` para carregamento principal da lista de tenants.
- `AgentsPage.jsx` adotou `useCrudList` para carregamento principal da lista de agentes.
- `ConfigPage.jsx` migrada para shell `CrudPageBase` sem alterar sub-abas internas (ARC-087).
- `FaqManagementPage.jsx` e `TicketMaintenancePage.jsx` migradas para shell `CrudPageBase` (ARC-089).
- Guardrail Jest expandido para cobrir `ConfigPage`, `FaqManagementPage` e `TicketMaintenancePage`.
- Validacao: `cd frontend && npm run build` concluido sem erros (851 modulos).

### ONDA 12 (concluida)
- `SupportPage.jsx` e `RAGDocumentsPage.jsx` migradas para shell `CrudPageBase` (ARC-090).
- `AccessControlPage.jsx` adotou `useCrudList` com recarga reativa por filtros (ARC-091).
- `CrudPageBase` evoluiu com `className`, `style` e `hideHeader` para cobrir telas complexas.
- Guardrails `crudBaseModuleWiring` atualizados para incluir Support/RAG e uso de `useCrudList` em AccessControl (ARC-092).
- `crudFeedback` criado/aplicado para padronizar toasts de erro/sucesso em paginas CRUD chave (ARC-093).
- UX de secoes e botoes harmonizada em `BackupPage`, `SsoScimPage` e `AccessControlPage` (ARC-094).
- Validacao: `vitest` (29/29 nos arquivos alvo), `jest` (7/7 no wiring), `npm run build` OK.

## Proximos candidatos de reducao de hotspot (pos-fechamento)
1. Extrair blocos internos de `SupportPage.jsx` e `RAGDocumentsPage.jsx` em componentes menores.
2. Modularizar trechos de `PbxPage.jsx` e `OperationsDashboardPage.jsx` com foco em estado e render.
3. Harmonizar filtros visuais em paginas especializadas sem reintroduzir base paralela.

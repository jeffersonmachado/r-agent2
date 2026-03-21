# Inventario Frontend: CRUD

## Panorama
- Paginas em `frontend/src/pages/**/*.jsx`: 91
- Paginas importadas no roteador principal (`main.jsx`): 71
- Paginas com forte sinal de operacao CRUD/API-driven (heuristica por imports/chamadas de API): 70

## Paginas de maior tamanho (proxy de complexidade)
- `GenerateSystemPage.jsx`: 6267 linhas
- `RAGDocumentsPage.jsx`: 3099 linhas
- `FlowEditorPage.jsx`: 3965 linhas
- `PbxPage.jsx`: 2350 linhas
- `SupportPage.jsx`: 1863 linhas
- `ConfigPage.jsx`: 1156 linhas
- `AnalyticsPage.jsx`: 698 linhas
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
- Hotspots de volume ainda existem em paginas especializadas como `GenerateSystemPage.jsx`, `FlowEditorPage.jsx` e `RAGDocumentsPage.jsx`.
- Ha variacao de UX em paginas fora dos fluxos CRUD principais.
- Extracoes futuras devem mirar reducao de tamanho/estado, nao reabertura do padrao canonico.

### ONDA 14 (progresso incremental em decomposicao)
- `RAGDocumentsPage.jsx`: extracao de modais dedicados (`rag-documents/*`) e reducao para 3099 linhas.
- `ConfigPage.jsx`: extracao das 12 abas para `pages/config/*` e reducao para 1156 linhas.
- `SupportPage.jsx`: extracao dos modais de atendimento para `pages/support/*` e reducao para 1863 linhas.
- `PbxPage.jsx`: consolidacao do shell com `PbxDashboardShell` e reducao para 2350 linhas.
- `AnalyticsPage.jsx`: extracao de secoes para `pages/analytics/*` e reducao para 698 linhas.
- `FlowEditorPage.jsx`: extracao dos overlays/dialogs para `pages/flow-editor/FlowEditorOverlays.jsx`, do painel direito para `pages/flow-editor/FlowEditorRightPanel.jsx`, da paleta para `pages/flow-editor/FlowEditorPalettePanel.jsx` e do canvas para `pages/flow-editor/FlowEditorCanvasSection.jsx`, com reducao para 3965 linhas.

### ONDA 15 (em andamento)
- `FlowEditorPage.jsx`: extracao da barra de ferramentas completa (Toolbar + dialogs associados + FlowCurrentDisplay) para `pages/flow-editor/FlowEditorToolbarSection.jsx`, com reducao para 3870 linhas.
- `FlowEditorPage.jsx`: extracao das helpers e handlers de zoom/viewport BPMN+engine para hook `pages/flow-editor/useFlowEditorBpmnZoom.js`, com reducao para 3672 linhas.
- `FlowEditorPage.jsx`: extracao do pipeline de exportacao (SVG/PNG/PDF e geracao de view model/markup) para hook `pages/flow-editor/useFlowEditorExport.js`, com reducao para 3614 linhas.
- `FlowEditorPage.jsx`: limpeza do bloco legado duplicado de exportacao (agora atendido somente por `useFlowEditorExport`), com reducao adicional para 3369 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de selecao/alinhamento/distribuicao de nos para hook `pages/flow-editor/useFlowEditorSelectionLayout.js`, com reducao para 3139 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de busca e navegacao (buscar/ir para/proximo/anterior) para hook `pages/flow-editor/useFlowEditorSearchNavigation.js`, com reducao para 2974 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de importacao/exportacao de arquivo (JSON/BPMN) para hook `pages/flow-editor/useFlowEditorFileIO.js`, com reducao para 2601 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de manutencao/replay (carregar replay, seek, simplify graph e validate-and-fix) para hook `pages/flow-editor/useFlowEditorMaintenance.js`, com reducao para 2451 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de controles de UI (showErrors, debug, estatisticas, optimize e minimap) para hook `pages/flow-editor/useFlowEditorUiControls.js`, com reducao para 2410 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de clipboard (copiar, colar e duplicar no modo engine) para hook `pages/flow-editor/useFlowEditorClipboard.js`, com reducao para 2324 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de canvas/historico (auto-arrange com fallback, undo/redo e toggle de reroute) para hook `pages/flow-editor/useFlowEditorCanvasHistory.js`, com reducao para 1928 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de workflow do editor (salvar, salvar template, validar, limpar, simular, testar, trocar ambiente e remover fluxo) para hook `pages/flow-editor/useFlowEditorWorkflowActions.js`, com reducao para 1721 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de ciclo de vida do fluxo (troca de tipo, selecao de fluxo, fluxo gerado por IA e selecao de template) para hook `pages/flow-editor/useFlowEditorLifecycle.js`, com reducao para 1208 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de interacao de no/historico (snapshot, selecao, troca de modo e atualizacao de config) para hook `pages/flow-editor/useFlowEditorNodeInteraction.js`, com reducao para 978 linhas.
- `FlowEditorPage.jsx`: extracao do cluster de realtime WebSocket (listener de eventos e status de conexao) para hook `pages/flow-editor/useFlowEditorRealtimeStatus.js`, com reducao para 931 linhas.
- `FlowEditorPage.jsx`: remocao do handler residual de importacao de template (`handleImportTemplate`) com acionamento direto via toolbar, reduzindo para 929 linhas.
- `GenerateSystemPage.jsx`: extracao do cluster de realtime do pipeline (listener `pipeline.status` + guarda de autenticacao WS) para hook `pages/generate-system/useGenerateSystemPipelineRealtime.js`, com reducao para 1358 linhas.
- `GenerateSystemPage.jsx`: extracao da configuracao visual do pipeline (labels + mensagens por etapa) para `pages/generate-system/generateSystemPipelineUiConfig.js`, com reducao para 1254 linhas.
- `GenerateSystemPage.jsx`: extracao da logica de validacao do formulario (pre-validacao e mensagens de erro) para `pages/generate-system/generateSystemValidationUtils.js`, com reducao para 1192 linhas.
- `GenerateSystemPage.jsx`: extracao da montagem de payload de execucao para `pages/generate-system/generateSystemPayloadUtils.js`, com reducao para 1180 linhas.
- `GenerateSystemPage.jsx`: extracao da atualizacao de status/detalhes do pipeline para hook `pages/generate-system/useGenerateSystemPipelineDetailsUpdater.js`, com reducao para 1078 linhas.
- `GenerateSystemPage.jsx`: extracao da logica de rate limit (estado, contador e clear) para hook `pages/generate-system/useGenerateSystemRateLimit.js`, com reducao para 1034 linhas.
- `GenerateSystemPage.jsx`: extracao do preenchimento automatico de objetivo inicial do fluxo para hook `pages/generate-system/useGenerateSystemInitialFlowObjective.js`, com reducao para 1004 linhas.
- `GenerateSystemPage.jsx`: extracao do helper de metadados de sugestao de descricao para `pages/generate-system/generateSystemDescriptionSuggestionUtils.js`, com reducao para 993 linhas.
- `GenerateSystemPage.jsx`: extracao do toast global de erro deduplicado para hook `pages/generate-system/useGenerateSystemErrorToast.js`, com reducao para 984 linhas.
- `GenerateSystemPage.jsx`: extracao da automacao do modo bootstrap (flags e fontes iniciais) para hook `pages/generate-system/useGenerateSystemBootstrapMode.js`, com reducao para 977 linhas.
- `GenerateSystemPage.jsx`: extracao da protecao de autenticacao/redirecionamento para hook `pages/generate-system/useGenerateSystemAuthGuard.js`, com reducao para 973 linhas.
- `GenerateSystemPage.jsx`: extracao da sincronizacao de estado de execucao para ref (`executingRef`) para hook `pages/generate-system/useGenerateSystemExecutingRefSync.js`, com reducao para 972 linhas.
- `GenerateSystemPage.jsx`: extracao do reset de estado visual do fluxo inicial para hook `pages/generate-system/useGenerateSystemInitialFlowUiReset.js`, mantendo contrato do orquestrador e preparando cortes maiores.
- `GenerateSystemPage.jsx`: extracao do bloco de validacao (`getValidationError` + `isValid`) para hook `pages/generate-system/useGenerateSystemValidationGate.js`, com reducao para 954 linhas.
- `GenerateSystemPage.jsx`: extracao da fabrica de payload para hook `pages/generate-system/useGenerateSystemPayloadBuilder.js`, com reducao para 951 linhas.
- `GenerateSystemPage.jsx`: extracao da montagem completa do contexto do orquestrador (7 objetos + buildOrchestratorBuilderContext) para hook `pages/generate-system/useGenerateSystemOrchestratorContext.js`, com reducao para 863 linhas.

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
1. Reduzir `GenerateSystemPage.jsx` e `FlowEditorPage.jsx` com extracoes por secao e hooks de estado.
2. Continuar modularizacao interna de `RAGDocumentsPage.jsx` e `PbxPage.jsx` (estado/fetch/acoes).
3. Harmonizar filtros visuais em paginas especializadas sem reintroduzir base paralela.

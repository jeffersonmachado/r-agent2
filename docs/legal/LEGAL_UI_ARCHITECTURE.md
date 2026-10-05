# LEGAL — arquitetura de UI e experiência

Data da inspeção: 2026-10-05. Escopo: discovery; nenhuma tela, rota, migration, modelo ou agente Legal foi criado. Os caminhos propostos abaixo são decisões de desenho futuras, não implementação existente. Evidência detalhada: [_evidence/vertical-ui-qa-findings.md](_evidence/vertical-ui-qa-findings.md). Resultado dos comandos executados nesta missão deve ser lido no registro de validação consolidado; existência de teste não equivale a execução bem-sucedida.

## Decisão

Legal deve entrar na SPA React existente, preservar `/workspace` como centro e usar os módulos de CRM, Inbox, tarefas, agenda, documentos e analytics. Há componentes reutilizáveis e guards server-side reais. A extensibilidade vertical é parcial: registro de IDs, templates persistidos, seleção da UI, dispatch de jobs e prova obrigatória ainda são mecanismos distintos. Adicionar apenas `legal` ao JSON canônico não instala a vertical inteira.

Há bloqueios concretos de segregação nas APIs alternativas de execução/gravação e no Agent Registry. Portanto a navegação Legal depende de corrigir essas fronteiras antes da habilitação operacional. Ocultar um item de menu não corrige uma API acessível diretamente.

## Shell e contexto existentes

| Papel na solução | Implementação verificada | Ponto de extensão futuro |
|---|---|---|
| Shell única | `frontend/src/main.jsx:1188` — `PrimaryRail`, `SecondaryNav`, `AreaHeader`, `CommandPalette`, `TenantGate` | Inserir os destinos Legal no router e na navegação existentes; preservar gate de tenant e classificação. |
| Autenticação e decisão de acesso | `frontend/src/main.jsx:834` — login; `frontend/src/main.jsx:863` — `canAccessPath`; `frontend/src/utils/menuPermissions.js:321` — `canAccessMenuItem` | UI consome classificação/capabilities da sessão; autorização final continua na API. |
| Áreas e navegação | `frontend/src/navigation/workspaceAreas.js:1`; `frontend/src/navigation/menu.js:1` | Usar a estrutura atual e componentes de navegação; não criar menu jurídico independente. |
| Workspace 360 | `frontend/src/pages/WorkspacePage.jsx:97`; `frontend/src/modules/workspace/WorkspaceLayout.jsx:49` | Contexto cliente/assunto jurídico ligado à entidade existente; abas jurídicas devem mostrar dados do domínio sem duplicar CRM. |
| Subnavegação vertical | `frontend/src/components/VerticalLayout.jsx:6`; `frontend/src/navigation/menu.js:413` — `verticalWorkspaces` | Resolver metadados por ID canônico e permissões/capabilities. Hoje existe fallback Beauty; precisa deixar de selecionar outra vertical quando Legal/tenant é desconhecido. |
| CRUD reutilizável | `frontend/src/modules/crud-base/CrudPageBase.jsx`; hooks `useCrudList`, `useCrudForm`, `useCrudFilters` | Usar composição dos componentes; lógica de prazo/processo continua no serviço backend. |
| IA contextual | `frontend/src/components/AskAiWidget.jsx:23`; `frontend/src/askAi/useAskAiEntityContext.js:28`; `POST /api/ask-ai` | Reutilizar widget e publicar entidade em foco; estender contratos/resolvers de posse antes de introduzir novos tipos de entidade. |
| Atualização realtime | `frontend/src/pages/VerticalOperationalDashboardPage.jsx:83` — `useWebSocketContext` | Eventos jurídicos transportados pelo WebSocket existente; sem polling de estado. |

`WorkspaceLayout` tem abas Resumo, Timeline, Conversas, Tickets, Tarefas, Agenda, Projetos, Documentos, Pagamentos, Insights IA e Ações (`workspaceDevSurface.js:28`). São abas de timeline/contexto, não prova de que já existem listas jurídicas completas. A aba Documentos recebe hoje documentos RAG ligados (`WorkspaceTimelineService.js:188`); gestão jurídica de versões, assinatura e cadeia de custódia requer extensão backend e UI apropriada.

## Mapa proposto, adaptado à implementação

```text
RAP /workspace — cliente e assunto jurídico em contexto
├── Inbox                /inbox                     existente
├── Clientes             /crm/contacts              existente
├── Processos            destino Legal futuro       extensão de domínio
├── Prazos               destino Legal futuro       estado jurídico explícito
├── Agenda               /agenda                    existente
├── Documentos           /rag-documents + contexto   extensão documental
├── Jurisprudência       destino Legal futuro       corpus com proveniência
├── Minutas              destino Legal futuro       rascunho + revisão
├── Atividades           /tasks + vínculo de assunto existente + extensão
├── Analytics            /analytics                 métricas do domínio
└── IA Jurídica          AskAiWidget                 contexto/tools especializados
```

Esses rótulos não devem renomear globalmente recursos de outras verticais. `/cases` é Case Management de atendimento, gated por `caseManagement`, e não representa automaticamente processo judicial: `frontend/src/pages/CasesPage.jsx:40`, `frontend/src/navigation/menu.js:74`, `tests/unit/caseManagement.test.js`. Inbox funciona sem Case Management e deve continuar assim.

| Necessidade | Componentes/API existentes | Reutilização e limite |
|---|---|---|
| Clientes e partes | `ContactsPage` em `frontend/src/pages/crm/ContactsPage.jsx:9`; `frontend/src/api/crm.js:32`; `GET /api/crm/contacts` | Reutilizar contato e relacionamento; papéis processuais são associações ao assunto, não novo cadastro de pessoa. |
| Comunicação | `InboxPage` em `frontend/src/pages/InboxPage.jsx`; `CasesPage`; contexto `ChannelConversation` | Atendimento permanece omnichannel; confirmação de envio externo exige política backend e revisão humana. |
| Atividades | `TasksPage` em `frontend/src/pages/TasksPage.jsx:57`; `frontend/src/api/workspace.js:27`; `/workspace/tasks` | Reutilizar tarefa; vínculo processo/prazo, responsável e evidência precisam contrato explícito. |
| Audiências e perícias | `ScheduleModal`; `ContactsPage.jsx:218`; `TasksPage.jsx:426`; `/agenda`, `/resources`, `/resource-bookings` em `frontend/src/api/workspace.js:31` | Reutilizar agendamento/reserva. Uma audiência não é cálculo ou confirmação de prazo. |
| Documentos | `RAGDocumentsPage`, `KnowledgeBasePage`; `frontend/src/api/ragDocuments.js:414` — upload; `/rag/documents/upload` | Reutilizar ingest/storage/query existentes; UI precisa distinguir original, versão, extração, indexação e minuta aprovada. |
| Jurisprudência | `KnowledgeBasePage.jsx:11`; `/rag/query`; `AskAiSources` | Compor busca/citação com identificação de fonte e data; ausência de precedente precisa estado vazio verificável, sem texto inventado. |
| IA contextual | `AskAiWidget.jsx:87`; `contextContract.js:27`; `entityResolvers.js:34` | Contract aceita CASE, mas lista com prova de posse implementada não inclui CASE. Não presumir que CASE habilita Legal; estender resolução autorizada. |
| Analytics | `AnalyticsPage.jsx:39`; componentes em `frontend/src/pages/analytics/`; dashboard vertical existente | Métricas legais são agregações backend de fatos reais. Painel atual está codificado para sete verticais e faz chamadas a todas (`VerticalOperationalDashboardPage.jsx:41`). |

Testes correspondentes existentes incluem `frontend/src/pages/InboxPage.test.jsx`, `CasesPage.test.jsx`, `frontend/src/__tests__/ContactsPage.scheduleModal.test.jsx`, `TasksPage.scheduleModal.test.jsx`, `frontend/src/api/ragDocuments.test.js`, `frontend/src/askAi/__tests__/useAskAiEntityContext.test.jsx`, `tests/unit/askAiEntityResolvers.test.js` e `frontend/src/pages/analytics/AnalyticsAttentionSection.test.jsx`. Eles validam mecanismos existentes, não a vertical Legal inexistente.

## Prazos e decisões humanas na UI

O usuário operacional deve ver separadamente DETECTED, ESTIMATED e CONFIRMED. DETECTED informa origem e trecho; ESTIMATED apresenta cálculo/proposta, base e incerteza; CONFIRMED apresenta pessoa autorizadora, instante, versão e justificativa. Nem seleção visual, nem geração por IA, nem criação de tarefa transforma uma estimativa em confirmação.

Agenda/tarefa podem representar lembrete da proposta antes da confirmação, mas precisam apresentar seu estado explicitamente. A confirmação exige transição autorizada no servidor e registro persistido. A UI oferece revisão de destinatário, conteúdo e anexos antes de WhatsApp/e-mail externo; assinatura e protocolo ficam em fluxo humano/controlado. Um botão de confirmação sozinho não satisfaz isso: rejeitar chamadas diretas sem aprovação válida, revalidar após edição e usar idempotência são critérios backend, tratados no assessment de segurança/agentes.

## Segregação obrigatória

| Classificação | Superfície Legal e RAP | Evidência/limitação atual |
|---|---|---|
| PRODUCTION | Cliente, assunto/processo, prazo, agenda, atividade, documento, minuta, jurisprudência, IA e analytics de negócio | Workspace sanitiza server-side, `api/services/workspace/timelineSanitization.js:133`; frontend `workspaceDevSurface.js:76` oculta QA/RPA. Agent Registry ainda permite descobrir agentes técnicos. |
| SUPPORT | Incidentes, diagnóstico, auditoria, evidência técnica, health e replay diagnóstico autorizado | `/platform-support` e `/rpa-replays` têm `classifications` no menu (`menu.js:353`, `menu.js:387`). APIs unificadas ainda dão acesso técnico além da leitura. |
| DEVELOPMENT | QA, Waves, Mesh, Seeds, Scenario Builder, cobertura, validação, regressão e gravação/execução RPA | APIs canônicas `qa-waves`, `qa-mesh` e `rpa-tests` usam classificação; aliases em `test-executions` e seed de templates ainda exigem correção. |

Classificação é independente de role de tenant: `api/modules/agent-os/experience-segregation.js:71` e `frontend/src/utils/classification.js:29`. Owner/admin/auditor sem platform role continuam PRODUCTION. A UI ainda exige `super_admin` para prefixos `/dev`, `/qa` e `/rpa` (`menuPermissions.js:394`), restringindo também alguns agentes DEVELOPMENT que não são super_admin. É uma divergência funcional a tratar sem enfraquecer a classificação.

LegalEvidence de negócio deve ser documento/artefato jurídico visível conforme ACL do domínio. Não alimentar diretamente a aba QA/RPA: hoje `WorkspaceTimelineService.js:189` transforma `Evidence` em evento `type=evidence`, e `timelineSanitization.js:36` o trata como técnico. Reutilizar o Evidence Engine para proveniência não obriga expor hash de replay ou painel de QA ao advogado; preservar relação interna e uma projeção operacional da prova jurídica.

Feature flags não concedem acesso: `frontend/src/utils/featuresConfig.js:66` aceita override localStorage, inclusive `NEW_NAVIGATION`, mas `main.jsx:863` aplica o guard antes da escolha de shell (`main.jsx:1174`). Uma eventual flag Legal serve para rollout/UX; habilitação de tenant e autorização devem ser verificadas no backend usando os mecanismos existentes de capabilities. Não usar localStorage como isolamento de vertical.

## Pendências anteriores à habilitação

1. **VUI-B1 — BLOCKER:** `test-executions/routes.js:27` aplica SUPPORT inclusive a QA Waves, gravação e execução técnica. Definir guards por endpoint e verificar todos os aliases.
2. **VUI-B2 — BLOCKER:** `agent-registry/routes.js:49` e `:69` não filtram classificação do agente alvo; PRODUCTION com RBAC de agents descobre SUPPORT/DEVELOPMENT.
3. **VUI-B3 — BLOCKER:** `agent-os/routes/vertical-templates.js:80` expõe seed com RBAC `agents:create`, sem DEVELOPMENT.
4. **VUI-R1 — REFACTOR:** harmonizar IDs canônicos e projeções de UI/templates/onboarding; remover fallback Beauty para uma vertical desconhecida; resolver a estratégia do enum de category antes de escolher `Legal` ou `Custom`.
5. **VUI-R2 — REFACTOR:** separar projeções operacionais de evidência jurídica das de QA/replay, mantendo sanitização técnica e verificação de posse.

Critérios de aceitação futuros: navegação direta e menus exercitados para os três níveis; PRODUCTION recebe 403 antes do handler técnico; SUPPORT recebe 403 em gravação/execução/QA; DEVELOPMENT autorizado consegue seus módulos; mudança de tenant limpa contexto IA; ausência de vertical não carrega Beauty; flags editadas no browser não mudam autorização; provas jurídicas autorizadas são acessíveis sem exposição de engenharia. Usar browser real e `tests/helpers/playwrightAuth.js:374` — `loginWithTenantSelection`; medir DOM, URL final, menu/sidebar, console e rede. Nenhuma validação browser foi realizada por este subassessment; testes centralizados precisam registrar seu resultado exato.

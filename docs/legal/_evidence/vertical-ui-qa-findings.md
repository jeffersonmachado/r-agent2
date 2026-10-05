# Evidências de verticais, UI, segregação e QA para Legal

Inspeção de código em 2026-10-05. Nenhuma implementação Legal. Leitura da Constituição, memórias de startup, `AI_MEMORY/agent-os.md`, `workspace.md`, `qa-waves.md`, `runtime-navigation.md`, `replay-engine.md`, `validation-rules.md`, `ui-responsividade.md` e índices canônicos. Referências `arquivo:linha` identificam símbolos verificados; provas runtime/testes executados são registradas pela validação consolidada da missão.

## As seis perguntas sobre verticais

| Pergunta | Resposta sustentada pelo código |
|---|---|
| Adicionar sem fork é possível? | **Sim, por extensão do mesmo RAP; configuração isolada ainda não basta.** A composição monta um router de vertical e serviços comuns (`api/composition/vertical/index.js:19`, `api/app/registerRoutes.js:133`, `api/app/routeRegistry.js:12`). IDs são dados em `config/verticals.json:6`; templates persistidos em `VerticalTemplate`. Não existe uma definição única consumida por UI, handlers, jobs, templates e QA. |
| Compartilham o core corretamente? | Compartilham auth, tenant, ORM, event ledger, notification, queue, scheduler e rotas da mesma API. Exemplos: `beautyJourneyService.js:18`, `clinicJourneyService.js:20`, `foodJourneyService.js:20`, `servicesJourneyService.js:20`, `marketJourneyService.js:18`; todos usam `customerJourneyEngine`/`notificationService`. **Não é um sim irrestrito:** o journey engine tem fallback em memória e ledger best effort, inadequados para fato jurídico confirmado. |
| Há duplicações? | **Sim.** Beauty e Clinic repetem estrutura de `queue*Notification` e `sendConfirmation`, reminder, follow-up (`beautyJourneyService.js:25`/`:58`; `clinicJourneyService.js:26`/`:55`). As rotas Clinic/Food/Services/Market repetem `ensureAuth`, tenant, metrics/timeline/event handlers. Onboarding frontend/backend espelham mapeamento vertical→segmento. IDs de UI e enum/templates formam catálogos paralelos de metadados. |
| Regras específicas estão espalhadas? | **Sim.** Regras ficam em `api/services/vertical/*`, router, scheduler, dispatch por kind, dashboard frontend, onboarding, catálogo de templates e QA. Isso inclui regras legítimas de domínio e dispatch de extensão. `customerJourneyEngine.js:184` especializa o subject Beauty; `verticalJourneyJobHandler.js:1379` mantém switch de jobs; `VerticalOperationalDashboardPage.jsx:31` mantém visibilidade por vertical. |
| Hardcodes a remover antes de Legal? | Resolver **universo/identidade/ativação** duplicados e defaults silenciosos: `menu.js:413`/`:563`/`:654`, `VerticalLayout.jsx:9`/`:19`, `OnboardingPage.jsx:22`/`:34`, `onboardingService.js:34`, `VerticalTemplate.js:25`, template `retail` versus registry `market`, `required-journeys.js:30`, dispatch/scheduler. Literais do próprio domínio (como `VERTICAL='clinic'`) não precisam ser apagados indiscriminadamente. |
| Legal deve validar/refatorar o sistema? | **Sim, como caso de extensão controlada, sem reconstruir tudo.** Validar uma única identidade canônica, habilitação de tenant, classificação, roteamento de serviços, contexto IA, bindings do Workspace e registro de jornadas executáveis. A primeira etapa remove bloqueios de segurança; a segunda refatora os pontos de extensão indispensáveis; o restante preserva o core. |

## Mecanismos encontrados e limites

| Mecanismo | Prova | Limite |
|---|---|---|
| Registry de verticais/domínios | `config/verticals.json:6`; `scripts/governance/validate-vertical-registry.js:202`; `tests/unit/verticalRegistry.test.js:78` | Sete `kind=vertical`: beauty, fitness, food, services, bakery, clinic, market. Legal ausente. Registry define identidade, não instala runtime. |
| Registry derivado para benchmark | `scripts/governance/lib/registered-verticals.js:24` — `loadRegisteredVerticals` | Consome o JSON canônico; não criar outro registry Legal. |
| Vertical templates persistidos | `api/db/models/VerticalTemplate.js:19`; `api/modules/vertical-templates/service.js:74`; `GET /api/vertical-templates` | Metadados de journeys/agents/knowledge/automations/KPIs em JSONB, escopo tenant obrigatório no serviço. Não há executador de instalação completa nesse CRUD. |
| Categoria de template | `VerticalTemplate.js:25`; `api/db/migrations/20260814090000-create-agent-os-core-tables.js` | Enum tem Custom, não Legal. Usar Custom evita migration de enum, mas não resolve IDs, habilitação ou implementação; decidir extensão compatível previamente. |
| Templates padrões | `vertical-templates/service.js:15`; template Retail `slug=retail` em `:65`; `seedDefaultTemplates` em `:124` | Sete templates, aliases de agentes antigos (`support-agent`). Se existe um template, seed retorna vazio; não suporta completar seletivamente uma nova vertical faltante. |
| Capability registry | `src/core/cognitive/capability-registry/index.js:32`; `config/canonical-capabilities.json` | Capabilities são independentes de vertical, com tools/permissões/visibilidade. Reutilizar; descriptor não cria serviço inexistente. |
| Module/feature registry | Busca de `VerticalRegistry`, `VerticalDefinition`, `VerticalTemplateRegistry`, `moduleRegistry`, `featureRegistry` em `src api engine config frontend/src` | Não foi encontrado um objeto único com esses nomes governando a extensão completa. Equivalentes reais são registry de IDs, composição de módulos, capability registry, flags e templates. |
| Feature flags | `frontend/src/utils/featuresConfig.js:39`; `lib/featureFlags.js`; `frontend/src/process-adapters/__tests__/featureFlagsEdgeCases.test.js` | Override localStorage é UX, não autorização. Flags não devem conferir acesso a Legal/QA/documentos. |
| Tenant vertical | `api/services/onboardingService.js:226` — `setTenantVertical`; `tests/unit/onboardingService.vertical.test.js`; frontend `OnboardingPage.jsx:22` | Backend deriva IDs canônicos; frontend mantém lista duplicada de sete opções e mapeamento para segmentos genéricos. |

## Comparação das sete verticais existentes

| Vertical | Serviço e recursos realmente usados | API/React | Teste correspondente e limite |
|---|---|---|---|
| Beauty | `beautyJourneyService`, `beautyServiceCatalog`, `billingOrchestrationService`; AccessSubject, sessões, agenda, notificação | `handleBeautyRoutes`; `/api/beauty/dashboard`; `BeautySchedulePage`, `BeautyCustomersPage`, `BeautyBundlesPage`, `BeautyServicesPage`, `BeautyPaymentsPage`, `BeautyLeadsPage`, `BeautyCampaignsPage` | `tests/unit/beautyJourneyService.test.js`; `tests/integration/verticalBeautyEndToEnd.test.js:27` usa mocks de DB, ledger e canais. |
| Fitness | `fitnessMembershipService`, `fitnessAttendanceService`, `fitnessChurnSignalService`; AccessMembership, VerticalAttendance, billing, access-control | `handleFitnessRoutes`; `/api/fitness/student`, `/api/fitness/dashboard`; `FitnessStudentsPage`, `FitnessMembershipsPage`, `FitnessAttendancePage` | `tests/unit/fitnessMembershipService.test.js`; `fitnessAttendanceService.test.js`; `frontend/src/pages/FitnessStudentsPage.test.jsx`; integração DB mock `verticalFitnessEndToEnd.test.js:27`. |
| Food | `foodJourneyService`; Order/orderService, pagamento, notifications, reviews/reorder | `handleFoodRoutes.js:62` — `/api/food/dashboard`; painel compartilhado `VerticalOperationalDashboardPage` | `tests/unit/foodJourneyService.test.js`; `tests/integration/verticalFoodEndToEnd.test.js:30` DB mock. |
| Clinic | `clinicJourneyService`, `noShowSignalService`; agenda, confirm/reminder, waitlist/recall | `handleClinicRoutes.js:64` — `/api/clinic/dashboard`; workspace UI `saude` e painel compartilhado | `tests/unit/clinicJourneyService.test.js`; `tests/integration/verticalClinicEndToEnd.test.js:28` DB mock. Não há app Clinic separado. |
| Bakery | `bakeryProductionService`, `bakeryDemandModelService`; VerticalProductionBatch, ML, Order, aprendizado de demanda | `handleBakeryRoutes.js:47`; `/api/bakery/production/plan`, `/outcome`, `/retrain`; UI `padaria` e painel compartilhado | `tests/unit/bakeryDemandModelService.test.js`; `tests/integration/verticalBakeryProductionLoop.test.js`; `verticalBakeryEndToEnd.test.js` inclui contratos/catálogo e runtime de fluxo, não prova por nome de browser/DB real. |
| Services | `servicesJourneyService`; quote lifecycle em VerticalJourneyEvent + cobrança, agenda e notificação | `handleServicesRoutes.js:108`; `/api/services/quote`, `/:quoteId/approve`; UI `servicos` e painel compartilhado | `tests/unit/servicesJourneyService.test.js`; `tests/integration/verticalServicesEndToEnd.test.js:29` DB mock. Quote approval não prova aprovação jurídica. |
| Market | `marketJourneyService`; Order, compra, restock, loyalty | `handleMarketRoutes.js:94` — `/api/market/dashboard`; UI `varejo`/`ecommerce`; template `retail` | `tests/unit/marketJourneyService.test.js`; `tests/integration/verticalMarketEndToEnd.test.js:26` DB mock. Três vocabulários, identidade canônica única deveria ser market. |

O script `test:vertical:integration` (`package.json:14`) executa somente Beauty/Fitness, embora as demais suites existam. Não extrapolar o resultado desse comando para sete verticais. Os testes com models mockados são regressão útil de orquestração, não verificação do esquema vivo ou da jornada do usuário.

## Segregação: controles presentes

| Controle | Código e endpoint | Teste |
|---|---|---|
| Resolução server-side de classificação | `experience-segregation.js:71` — platformClassification → platformRole → super_admin → PRODUCTION; `requireClassification.js:39` | `tests/governance/experienceSegregation.test.js`; `tests/unit/ragAgentSegregation.test.js` |
| Menus/direct URLs | `menu.js:361` — QA super_admin; `:381` Waves; `:387` replay SUPPORT+; `menuPermissions.js:413` | `frontend/src/navigation/menu.test.js:122`; `frontend/src/utils/menuPermissions.test.js:62`/`:122` |
| Workspace frontend | `workspaceDevSurface.js:76`/`:84` — tab técnica DEVELOPMENT-only; `WorkspaceLayout.jsx:54` | `workspaceDevSurface.test.js:12`; `WorkspaceRightRail.test.jsx` |
| Workspace API | `workspace.controller.js:39` — `/workspace/entities/:id/autocorrections` somente DEVELOPMENT; timeline recebe classificação em `:30`; `timelineSanitization.js:133` | `workspace.routes.test.js:132`; `tests/unit/workspaceApiSegregation.test.js` |
| QA APIs | `qa/routes.js:12`; `qa-waves/routes.js:29`; `qa-mesh/routes.js:10` — DEVELOPMENT | `api/modules/qa/routes.test.js`; `qa-waves/routes.test.js:290`; testes de governança da segregação |
| RPA canônico | `rpa-tests/rpaRouteUtils.js:32` — leitura SUPPORT; `:51` — gravação/execução DEVELOPMENT | `tests/unit/rpaTestGenerationRoutes.test.js`; `tests/governance/experienceApiSegregation.test.js:188` |
| Marketplace | `agent-os/routes/agent-marketplace.js:13`/`:46` — filtro de catálogo; `:58` detalhe; `:80` instalação | `api/modules/agent-os/__tests__/agent-os-hardening.test.js` |

## Blockers concretos encontrados

### VUI-B1 — aliases unificados expõem engenharia a SUPPORT

`api/modules/test-executions/routes.js:21` — `ensureAuth` aplica `checkClassification(req,'SUPPORT')` em `:27` a todo router. É adequado para leitura de replay; inadequado para:

- `GET /api/test-executions/qa-waves/journeys` (`:63`), `/journey-status` (`:77`), `/scenarios` (`:91`), `/step-status` (`:105`): exposição de cenário/Wave de engenharia a SUPPORT.
- `POST /api/test-executions/recordings/start` (`:119`) e `/:recordingId/stop` (`:148`), `GET .../status` (`:167`): gravação técnica a SUPPORT.
- `POST /api/test-executions` (`:328` → `deps.createExecution`) e `POST /api/test-executions/:executionId/cancel` (`:446`): controle de execução técnica a SUPPORT.

Router é montado em `api/app/routeRegistry.js:39`, dependencies em `api/composition/test-executions/index.js:36` não adicionam classificação nem `qa:execute`. Os testes `api/modules/test-executions/routes.test.js:56` verificam sete casos de GET/read; não cobrem negativa SUPPORT nessas mutações/aliases.

`scripts/governance/validate-experience-api-segregation.js:57` enumera qa-waves/qa-mesh e sua seção RPA inspeciona apenas `rpa-tests`; esse gate não detecta os aliases unificados. **PASS do gate existente não refuta este achado.** Prova segura a produzir: router real em HTTP in-process, `req.agent.platformRole=support_n2`, services mockados para contar se foram chamados; afirmar 403 e zero chamada em endpoints técnicos, 200 em leitura autorizada. Não iniciar gravação real como diagnóstico.

### VUI-B2 — Agent Registry sem filtragem de classificação

`api/modules/agent-registry/routes.js:34`/`:61` validam auth/RBAC/tenant; `:49` retorna toda a lista do serviço e `:69` busca detalhe por ID, sem `canAccess` ou `validateAgentVisibility`. `service.js:22` só restringe tenant e filtros opcionais; `classification` pode ser fornecida pela query (`routes.js:43`). Owner/admin PRODUCTION têm `agents:list_all`/`read` (`api/services/rbacService.js:76`, `:189`) e portanto podem descobrir CorporateAgent SUPPORT/DEVELOPMENT do próprio tenant.

Mesmo handler é montado pelo `api/modules/agent-os/index.js:35`; `api/app/routeRegistry.js:46` monta Agent OS. Marketplace tem o controle em `agent-marketplace.js:46`, Registry não. Isso é vazamento técnico no tenant, não prova de cross-tenant e não prova de execução de tool acima da classificação. Correção precisa bloquear descoberta/detalhe e criar/alterar classificação superior ao ator; preservar o controle separado do Supervisor/Tool Registry.

### VUI-B3 — seed de templates sem DEVELOPMENT

`POST /api/vertical-templates/seed` em `api/modules/agent-os/routes/vertical-templates.js:80` exige auth, tenant e `agents:create` (`:82`), concedido ao owner/admin PRODUCTION. Não aplica classificação. É seed acessível por URL operacional, contrariando missão e Constituição. Restringir operação de seed técnica sem transformar leitura de templates de negócio em engenharia.

### VUI-B4 — reuso direto do journey engine não oferece persistência/evidência fail-closed

`api/services/vertical/customerJourneyEngine.js:171` fabrica objeto `status='emitted'` quando DB indisponível. `:178` grava event ledger best effort e `:188` ignora falha. `listJourneyEvents` (`:207`, `:221`) converte ausência/erro de persistência em lista vazia. Persistência real/auditoria são necessárias antes de usar esse mecanismo para confirmação de prazo, peça aprovada ou comunicação jurídica. Não afirmar que todos os demais serviços de RAP têm esse defeito; Bakery já lança `persistence_required` (`bakeryProductionService.js:94`, `:133`). Se Legal usar diretamente serviços canônicos com falha explícita, o desenho pode evitar esse caminho; não copiar o fallback para código novo.

## Refactors e drift documentados

- **VUI-R1 / REFACTOR:** `verticalWorkspaces` tem 11 keys, enquanto o registry canônico tem sete verticais; `ecommerce` e `varejo` representam market, `saude` representa clinic, `padaria` bakery, `servicos` services. `educacao`, `financeiro`, `cobranca` têm metadados de UI sem implementação vertical correspondente localizada nesta inspeção (**MISSING_IMPLEMENTATION** para tratá-las como verticais plenas). Não confundir metadado UI com suporte de domínio.
- **VUI-R2 / REFACTOR:** fallback `beauty` em `menu.js:654`/`VerticalLayout.jsx:9` e chamadas a sete dashboards em `VerticalOperationalDashboardPage.jsx:41` mesmo quando apenas um é visível. Não é cross-tenant por si; é decisão de UX/dispatch que não incorpora Legal declarativamente.
- **VUI-R3 / REFACTOR:** `verticalSchedulerService.js:46` descobre memberships só beauty/fitness/clinic e adiciona tenants por eventos; enfileira jobs de várias verticais para todo tenant descoberto (`:89`). `verticalJourneyJobHandler.js:1379` usa switch por kind. Usar scheduler/queue existentes com habilitação explícita e handler jurídico futuro, sem novo scheduler paralelo.
- **VUI-R4 / REFACTOR:** required universe de prova `governance/shared/required-journeys.js:30` hardcode de sete; benchmark `registered-verticals.js:24` já deriva o registry. Adicionar Legal ao registry não adiciona sua prova obrigatória. Conciliar com explicit enablement/readiness de nova vertical, sem hardcoded PASS.
- **VUI-R5 / REFACTOR:** frontend `/dev` exige super_admin mesmo para platform developer não super_admin (`menuPermissions.js:421`). Esse excesso de restrição não é vazamento; resolução deve manter política DEVELOPMENT e RBAC granular.
- **DOCUMENTATION_DRIFT:** `AI_MEMORY/runtime-navigation.md` mantém texto histórico de QA para supervisor+ e status operacional em `/dev/system-status`; código atual `menu.js:174`/`:361` restringe super_admin.
- **DOCUMENTATION_DRIFT:** `docs/VERTICALS_BEAUTY_FITNESS.md` diz notificações stubs/providers não conectados; `notificationService.js:9` usa WhatsApp real e `:455` envia SMTP. A disponibilidade de provider/credenciais precisa runtime; o claim absoluto de stub está desatualizado.
- **UNPROVEN:** referências históricas de browser e counts em `docs/governance/VERTICALS_COVERAGE.md` não provam extensão jurídica nem os aliases vulneráveis; medir novamente no escopo da missão.

## Matriz de reuso para consolidação

Percentuais são estimativas arquiteturais do substrato reutilizável, não cobertura medida ou conclusão de readiness.

| Capability | Existing implementation | Files | Reuse % | Gap | Required change | Risk | Priority | Dependency | Classification | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Identidade/ativação vertical Legal | Registry IDs, tenant settings, templates persistidos | `config/verticals.json`; `onboardingService.js`; `VerticalTemplate.js`; `menu.js` | 65 | Catálogos divergentes, enum e defaults | Uma identidade canônica; projeções UI e habilitação; template versionado | Médio | P1 | Decisão do domínio/capabilities | PRODUCTION | REFACTOR |
| Workspace Jurídico | WorkspaceLayout, timeline, links, actions | `WorkspacePage.jsx`; `WorkspaceLayout.jsx`; `workspace.controller.js` | 80 | Associação de assunto/processo e apresentação jurídica | Compor contexto e tabs sobre dados de domínio | Médio | P1 | Models/ACL/projeções | PRODUCTION | EXTEND |
| Menu e rotas jurídicas | Shell/RBAC/tenant guard/VerticalLayout | `main.jsx`; `menu.js`; `menuPermissions.js` | 75 | Fallback Beauty e router manual | Registrar destinos na mesma SPA; UI orientada a capacidades | Médio | P1 | Identidade/ativação | PRODUCTION | REFACTOR |
| IA Jurídica contextual na UI | AskAiWidget + entidade contexto | `AskAiWidget.jsx`; `useAskAiEntityContext.js`; `contextContract.js`; `entityResolvers.js` | 75 | Tipo/posse/allowlist de tools jurídica ausente | Estender contratos e ownership, preservar widget | Alto | P1 | ACL/tools/policy | PRODUCTION | EXTEND |
| Prova jurídica visível | Evidence e Documento ligados ao Workspace | `WorkspaceTimelineService.js:189`; `timelineSanitization.js:36` | 60 | Evidence é tratado como engenharia | Projeção jurídica de documento/prova; vínculo técnico interno | Alto | P1 | Domain model/evidence ACL | PRODUCTION | REFACTOR |
| QA jurídica | Waves/mesh/coverage/journey contracts/seeds/browser adapters | `qaWavesService.js`; `qa-mesh/meshRunner.js`; `qa/coverage/`; `config/journey-criticality.json` | 85 | Jornadas, fixtures e assertions Legal inexistentes | Registrar casos de domínio e executá-los no runtime real | Alto | P1 | Domínio/policy/RAG | DEVELOPMENT | EXTEND |
| Replay diagnóstico | RPA, replay integrity, SUPPORT route | `rpaRouteUtils.js`; `test-executions/routes.js`; `lib/replayIntegrity.js` | 90 | Aliases de engenharia no router SUPPORT | Guards por operação; negativa SUPPORT antes do handler | Crítico | P0 | VUI-B1 | SUPPORT | BLOCKER |
| Agent Registry operacional | CRUD tenant-scoped de CorporateAgent | `agent-registry/routes.js`; `service.js`; `rbacService.js` | 85 | Descoberta técnica por PRODUCTION | Filtrar/autorizar classificação do alvo em todos os endpoints | Alto | P0 | VUI-B2 | PRODUCTION | BLOCKER |
| Seeds/templates técnicos | Seed DB tenant-scoped | `agent-os/routes/vertical-templates.js:80` | 90 | Seed PRODUCTION via agents:create | Exigir DEVELOPMENT para seed | Alto | P0 | VUI-B3 | DEVELOPMENT | BLOCKER |
| Journey persistence para fatos jurídicos | Journey events + ledger | `customerJourneyEngine.js:171` | 70 | Fallback em memória/ledger ignorado | Não usar fallback; atomicidade e falha explícita no caminho Legal | Alto | P0 | VUI-B4, escolha de serviço canônico | PRODUCTION | BLOCKER |

## QA futura sem exposição operacional

Reutilizar `qa/qa-waves/scenario-store.json`, `config/qa-waves-registry.json`, `config/journey-contracts.json`, `config/journey-preconditions.json`, `config/journey-scenario-links.json`, `config/journey-criticality.json`, `qa-mesh/meshRunner.js` e adapters reais existentes. `qa/contracts/journeyCriticality.js:88` resolve severidade declarativa; não adicionar lista jurídica de blocking journeys em código.

Definição não conta como execução. Ligação de jornada precisa cenário executável com assertions e resultado de runtime; `qa/coverage/journeyLinks.js` distingue catálogo declarativo do mesh. Evidence Store em `qa/coverage/evidenceStore.js` oferece hash chain/redaction; não usar esse armazenamento de QA como banco de processo/prazo jurídico.

| Jornada a registrar futuramente | Assertions negativas/positivas necessárias |
|---|---|
| Intimação → classificação → prazo detectado → atividade → minuta | Documento/origem, tenant, processo e idempotência preservados; estado DETECTED; minuta draft; nenhum envio/protocolo executado. |
| Documento → classificação → processo identificado → pendência | Arquivo autorizado, vínculo verificável, nenhum vínculo automático ao processo de outro tenant; ambiguidades exigem humano. |
| Prazo ambíguo | Nenhum CONFIRMED sem aprovação persistida; task/agenda exibem estimativa; expiração de approval/edit bloqueia confirmação. |
| Jurisprudência inexistente | Resposta sem precedente e fontes vazias/insuficientes; nenhuma citação/hit fabricado. |
| Mensagem externa | Rejeitar envio sem aprovação e com aprovação reutilizada/alterada/cross-tenant; enviar uma vez quando aprovada e produzir receipt real. |
| Segregação de perfis/aliases | PRODUCTION não vê QA/RPA/replay/Seeds; SUPPORT só diagnóstico/leitura; engenharia só DEVELOPMENT; chamadas diretas negadas antes do handler. |
| Persistência indisponível | Falha explícita, nenhum prazo confirmado/evento legal fabricado; retries idempotentes e auditoria verificável. |

Browser deve usar `tests/helpers/playwrightAuth.js` e papéis dos três níveis, exercitar menu e URL direta, console/rede, troca de tenant e entidades de outro tenant. QA/RPA/Seeds permanecem em DEVELOPMENT; replay diagnóstico em SUPPORT. Testes de processos inexistentes não foram inventados nesta missão.

Validações existentes a registrar pela coordenação: suites `verticalRegistry`, `onboardingService.vertical`, `verticalCompositionCutoverWiring`, módulos `qa`, `qa-waves`, `test-executions`, `workspace`, governança `experienceSegregation`/`experienceApiSegregation`, frontend `menu`/`menuPermissions`/`workspaceDevSurface`/`VerticalLayout`/`VerticalOperationalDashboardPage`; gates `validate:vertical-registry`, `validate:visibility-policy`, `validate:experience-segregation`, `validate:experience-api-segregation`, `validate:qa-waves-registry`, `validate:coverage-gate`. Executar testes seguros dos novos achados como diagnóstico sem adicionar implementação ou suite Legal nesta fase.

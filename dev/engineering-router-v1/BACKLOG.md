# ENGINEERING_ROUTER_V1 — Backlog de Implementação

Estados: `TODO` `RED` `IMPLEMENTING` `GREEN` `BLOCKED_EXTERNAL`

| ID | Descrição | Dependências | Arquivos principais | Teste | Status |
|---|---|---|---|---|---|
| ERV1-01 | Constantes de domínio (task types, risk, scope, capabilities, states) | — | `engine/engineeringRouter/constants.js` | `tests/unit/engineeringRouterConstants.test.js` | GREEN |
| ERV1-02 | Model capabilities (extensão do registry sem duplicar) | ERV1-01 | `engine/engineeringRouter/modelCapabilities.js` | `tests/unit/engineeringRouterModelCapabilities.test.js` | GREEN |
| ERV1-03 | TaskClassifier determinístico | ERV1-01 | `engine/engineeringRouter/taskClassifier.js` | `tests/unit/engineeringRouterTaskClassifier.test.js` | GREEN |
| ERV1-04 | Routing Policy versionada | ERV1-01, ERV1-02 | `engine/engineeringRouter/routingPolicy.js` | `tests/unit/engineeringRouterRoutingPolicy.test.js` | GREEN |
| ERV1-05 | Model selector (coder/reviewer, independência, reason codes) | ERV1-02, ERV1-04 | `engine/engineeringRouter/modelSelector.js` | `tests/unit/engineeringRouterModelSelector.test.js` | GREEN |
| ERV1-06 | Path boundary (allowed/forbidden paths) | ERV1-01 | `engine/engineeringRouter/pathBoundary.js` | `tests/unit/engineeringRouterPathBoundary.test.js` | GREEN |
| ERV1-07 | Patch validator (unified diff) | ERV1-06 | `engine/engineeringRouter/patchValidator.js` | `tests/unit/engineeringRouterPatchValidator.test.js` | GREEN |
| ERV1-08 | Secret redaction | ERV1-01 | `engine/engineeringRouter/secretRedaction.js` | `tests/unit/engineeringRouterSecretRedaction.test.js` | GREEN |
| ERV1-09 | Command policy (allowlist) | ERV1-01 | `engine/engineeringRouter/commandPolicy.js` | `tests/unit/engineeringRouterCommandPolicy.test.js` | GREEN |
| ERV1-10 | State machine (transições válidas) | ERV1-01 | `engine/engineeringRouter/stateMachine.js` | `tests/unit/engineeringRouterStateMachine.test.js` | GREEN |
| ERV1-11 | Models Sequelize + migration | ERV1-01 | `api/db/models/Engineering*.js`, migration | `tests/unit/engineeringTaskModel.test.js` | GREEN |
| ERV1-12 | EngineeringTaskService (CRUD, idempotência, lock, restart-safe) | ERV1-10, ERV1-11 | `api/services/engineeringRouter/engineeringTaskService.js` | `tests/unit/engineeringTaskModel.test.js` | GREEN |
| ERV1-13 | ContextBuilder (I/O real, orçamento, redação) | ERV1-08 | `api/services/engineeringRouter/contextBuilderService.js` | `tests/unit/engineeringContextBuilder.test.js` | GREEN |
| ERV1-14 | CoderService + engineeringAiInvoker (chamada real via aiProviderManager) | ERV1-13, ERV1-02 | `api/services/engineeringRouter/coderService.js`, `engineeringAiInvoker.js` | `tests/contracts/engineeringCoderReviewerService.test.js` | GREEN |
| ERV1-15 | ReviewerService (decisão estruturada APPROVE/REJECT) | ERV1-13, ERV1-02 | `api/services/engineeringRouter/reviewerService.js` | `tests/contracts/engineeringCoderReviewerService.test.js` | GREEN |
| ERV1-16 | PatchApplyService (git worktree isolado via snapshot commit + rollback) | ERV1-07 | `api/services/engineeringRouter/patchApplyService.js` | `tests/integration/engineeringPatchApplyAndTestRunner.test.js` | GREEN |
| ERV1-17 | TestRunnerService (execução determinística, evidência em disco) | ERV1-09, ERV1-16 | `api/services/engineeringRouter/testRunnerService.js` | `tests/integration/engineeringPatchApplyAndTestRunner.test.js` | GREEN |
| ERV1-18 | EngineeringModelRouterService (orquestração completa RED→FIX→REVIEW) | ERV1-12..17 | `api/services/engineeringRouter/engineeringRouterService.js` | `tests/integration/engineeringRouterFullLoopE2E.test.js` | GREEN |
| ERV1-19 | API REST + composition + registro real de rota | ERV1-18 | `api/modules/engineering-router/routes.js`, `api/composition/engineering-router/index.js`, `registerRoutes.js`, `routeRegistry.js` | `tests/unit/engineeringRouterRoutes.test.js` | GREEN |
| ERV1-20 | UI: Overview/Tasks/TaskDetail/Models/ReleaseClosure | ERV1-19 | `frontend/src/pages/Engineering*.jsx`, `main.jsx`, `menu.js` | `npm run build` (frontend) + `vitest run` (964/964 sem regressão) | GREEN |
| ERV1-21 | Gate de governança `ENGINEERING_ROUTER_V1` | ERV1-19 | `scripts/governance/validate-engineering-router-v1.js` | execução direta: 41/41 checks PASS | GREEN |
| ERV1-22 | E2E fixture (bug simples, RED→patch→GREEN→review) | ERV1-18 | `tests/fixtures/engineering-router-sandbox/`, `tests/integration/engineeringRouterFullLoopE2E.test.js` | jest (3/3 PASS) | GREEN |
| ERV1-23 | Documentação V1 (5 documentos + backlog + baseline) | tudo acima | `docs/architecture/ENGINEERING_MODEL_ROUTER_*.md` | leitura | GREEN |
| ERV1-24 | Pilot real (uma tarefa real do RAP, chamada de rede real a um LLM) | ERV1-19 | — | execução real via UI (Playwright) contra o servidor de dev real | **GREEN** — task `88b903bd-9089-4708-87a0-449c62f2d409` ("Adicionar teste unitário para typeCompatibility.js"): CODER real `openai:gpt-5.4-mini` gerou o patch, `TESTING` rodou `npx jest ...` de verdade em workspace isolado (exit code 0), REVIEWER real `openai:gpt-4o` (provider diferente do coder) aprovou. Ver `docs/architecture/ENGINEERING_MODEL_ROUTER_MANUAL.md`. |
| ERV1-25 | Robustez de parsing de resposta do CODER (aspas embutidas quebrando o JSON externo) | ERV1-14 | `engine/engineeringRouter/responseParsing.js` (`repairCoderResponse`), `coderService.js` | `tests/unit/engineeringRouterResponseParsingRepair.test.js` (cobertura via uso real no pilot) | GREEN — achado real durante o pilot (V1_BLOCKER), corrigido |
| ERV1-26 | Robustez de contagem de hunk (LLM erra `@@ -a,b +c,d @@`) | ERV1-16 | `engine/engineeringRouter/hunkNormalizer.js`, `patchApplyService.js` | `tests/unit/engineeringRouterHunkNormalizer.test.js` (5/5 PASS) | GREEN — achado real durante o pilot (V1_BLOCKER), corrigido |
| ERV1-27 | Modelo reviewer inexistente/descontinuado no mapeamento de capability (`gpt-5.5-pro`, `gpt-5-codex`) | ERV1-02 | `engine/engineeringRouter/modelCapabilities.js` (adiciona `openai:gpt-4o`, confirmado real) | verificação manual contra a API real da OpenAI | GREEN — achado real durante o pilot (V1_BLOCKER), corrigido (modelos antigos mantidos, não removidos — apenas não confiáveis nesta conta) |
| ERV1-28 | Manual de utilização com prints reais | ERV1-24 | `docs/architecture/ENGINEERING_MODEL_ROUTER_MANUAL.md`, `docs/architecture/assets/engineering-router-manual/*.png` | leitura | GREEN |
| ERV1-29 | Feedback em tempo real via WebSocket (feed de atividade + arquivos alterados ao vivo na Task Detail) | ERV1-18, ERV1-20 | `api/services/engineeringRouter/engineeringRouterEvents.js`, `engineeringRouterService.js`, `frontend/src/pages/engineering-router/useEngineeringTaskRealtime.js`, `EngineeringTaskDetailPage.jsx` | validação real via Playwright, sem polling/setInterval | GREEN — reaproveita `emitEvent`/`websocketService.js` já existente, mesmo padrão de `pipeline.status` |
| ERV1-30 | `node_modules` (symlink de infraestrutura do workspace isolado) aparecia como arquivo alterado | ERV1-16, ERV1-29 | `patchApplyService.js` (`listChangedFiles`) | `tests/integration/engineeringPatchApplyAndTestRunner.test.js` | GREEN — achado real ao validar o feed ao vivo, corrigido |
| ERV1-31 | Rota ausente para super-admin salvar credenciais de IA de um tenant específico (`?tenant=<id>` na UI de config) | — | `api/modules/tenant/{routes,controller,service}.js` (nova `PUT /tenants/:tenantId/ai-credentials`) | `tests/unit/tenantAiCredentialsSaveRoute.test.js` (5/5 PASS) | GREEN — achado real ao restaurar credenciais via UI, corrigido |
| ERV1-32 | Credencial de IA sem saldo/inválida agora é destacada (nunca mais apagada) | — | `api/db/migrations/20260921012917-add-status-to-tenant-ai-credentials.js`, `api/services/aiCredentialValidation.js`, `tenantAIService.js`, `ConfigAiTab.jsx` | `tests/unit/tenantAiCredentialsTestRoute.test.js`, `tests/unit/tenantAiCredentialsSaveRoute.test.js` | GREEN — feedback do usuário após deleção incorreta de credenciais sem saldo |
| ERV1-33 | Status real da credencial passou a definir elegibilidade de roteamento (circuit breaker não cobre erros de billing) | ERV1-32 | `engineeringModelAvailabilityService.js` | `tests/unit/engineeringModelAvailabilityService.test.js` (5/5 PASS) | GREEN — achado real ao restaurar uma credencial DeepSeek sem saldo, que continuava sendo escolhida como mais barata |

## Regressão verificada
- `npm run test:unit` (backend, 833 suítes / 6331 testes): sem regressão. 3 falhas observadas em execução sob carga total (timeout) não se reproduzem isoladamente — pré-existentes/ambientais, não causadas por esta missão.
- `vitest run` (frontend, 129 suítes / 964 testes): 964/964 PASS, 0 falhas.
- `node scripts/governance/validate-route-mounts.js`: PASS (60 declarados = 60 montados, incluindo o novo router).
- `node scripts/governance/validate-engineering-router-v1.js`: PASS (44/44 checks).
- Suíte completa do Engineering Router (unit+contract+integration+E2E) após todas as correções do pilot: PASS, 0 falhas.

## Pilot real — resumo final
Executado via UI real (Playwright dirigindo o browser, autenticado como `systemadmin`),
contra o servidor de desenvolvimento real (`node api/server.js`) e o banco real usado por ele
(`postgresql://.../r_agent2`), com credenciais reais configuradas pela própria missão via
`/config?tenant=system&tab=ai` (chaves fornecidas pelo usuário em `~/tokens.txt`, nunca
hardcoded em código). Três achados reais de robustez (ERV1-25, ERV1-26, ERV1-27) só apareceram
ao rodar contra um LLM de verdade — nenhum deles era visível nos testes com fake provider — e
foram corrigidos no próprio código do Router, com teste de regressão para o caso de contagem de
hunk. Task final: **GREEN**, ponta a ponta, sem nenhum dublê.

## Incidente durante a execução
Um pipeline de selagem de release de outra sessão (`seal-release.sh`/`two-pass-release.sh`)
rodou concorrentemente e descartou o trabalho não commitado desta missão via checkout do
working tree. Todo o trabalho foi recriado integralmente a partir do conteúdo já validado.
Ver nota em `ENGINEERING_ROUTER_V1_BASELINE.md` e item registrado em
`POST_RELEASE_MODEL_ROUTER_BACKLOG.md`.

Atualizado incrementalmente durante a execução.

# AUTONOMOUS READINESS HARDENING — Rastreabilidade

Missão: auditoria → correção → prova das 10 invariantes arquiteturais do RAP.
Baseline (FASE 0, 2026-08-18): branch `main` @ `fd220037`, working tree limpo,
`test:unit` 2856/2856 verde, `test:system` 84/84 verde,
`validate:governance-enforcement` exit 0 (governance-score PASS/100),
inventário reconstruído do source: 2760 itens (drift +19 da feature
journey-faq absorvido).

## Matriz de gaps (auditoria de 12 frentes, 2026-08-18)

| ID | Gap | Causa raiz | Arquivos | Status |
|----|-----|-----------|----------|--------|
| HARD-001 | Tenant fallback `|| 'system'` em módulos Agent OS/registry, learning-core, support-debug, executionQueue | `req.tenant_id` (snake_case) nunca é populado; middlewares setam `req.tenantId` — fallback dispara 100% das vezes | api/modules/agent-os/routes/*.js, api/modules/agent-registry/routes.js, api/modules/learning-core/routes.js, api/modules/support-debug/routes.js, api/services/executionQueueService.js | FIXED (W1-A) |
| HARD-002 | Principal fallback `req.user?.username \|\| 'system'` — `req.user` nunca é populado; approvedBy/actor sempre 'system' | requireAuth popula `req.agent`, não `req.user` | agent-factory.js:112,218,246; agent-orchestrator.js:256 | FIXED (W1-A/W2-A) |
| HARD-003 | MCP HTTP boundary: `POST /mcp` sem requireAuth (401 permanente = inoperante), tenant `|| 'system'`, sem resolveActorToolPermissions, rota nunca montada; fallback por nome em client-hub.getConnection; toolId externo sem tenant | bootstrap Express fora do pipeline de auth | api/runtime/startMcpServer.js, src/core/mcp/client-hub.js:65-70, src/core/mcp/external-tool-adapter.js:88, api/server.js:173-191 | FIXED (W1-B) |
| HARD-004 | Mutation sem Outcome Contract completa como sucesso (ex.: `consultar_metricas`→`workspace.generateInsight` sideEffects:true sem contrato); evidência = presença de campo de qualquer step; `failureIfDenied` morto; contrato `messaging.send` órfão; sem classificação READ_ONLY/MUTATION | planner não vincula tool.sideEffects → contrato obrigatório | src/core/cognitive/outcome/index.js, action-planner/index.js, tool-registry/index.js | FIXED (W3) |
| HARD-005 | `agent.execution.completed` ignora `businessOutcome.valid` (isSuccess só olha status técnico) | mapeamento de evento pré-outcome | cognitive-orchestrator/index.js:343-363 | FIXED (W3) |
| HARD-006 | `human_handoff_requested` → `agent.execution.completed` + `business.outcome.failed` contraditório; learning-engine emite `cognitive.execution.failed` para o mesmo handoff | taxonomia sem evento de handoff | cognitive-orchestrator/index.js:227,343-348,388; learning-engine/index.js:46-51; api/events/eventModelV1.js:87-101 | FIXED (W3) |
| HARD-007 | RPA gravação/execução técnica acessível a SUPPORT (guard único `ensureSupportAccess`); divergência SUPPORT_VISIBLE_ROUTES vs frontend (`/rpa-replays`) | guard único para replay (leitura) e RPA (escrita técnica) | api/modules/rpa-tests/rpaRouteUtils.js, handleRpaRecordingsRoutes.js, handleRpaExecutionRoutes.js, experience-segregation.js, menuPermissions.js | FIXED (W2-B) |
| HARD-008 | Agent Factory: publish não exige `approved`, auto-approval (`approvedBy`=actor do publish), approve inalcançável (gate 4 exige approvedBy antes de existir), gates por presença (waveId/evidenceId strings), RBAC sem agents:approve/publish para papéis, actorRole hardcoded 'super_admin' | validateAndPublishAgent não lê lifecycle; gate order invertido | agent-hardening-service.js:389-528, agent-factory.js, rbacService.js | FIXED (W2-A) |
| HARD-009 | Verticais sem fonte canônica: `mercado` vs `market` no meshRegistry/scenario-store; alias `mercado→market` ausente em domainAliases; templates usam `retail`, readiness usa `market`; 4+ listas independentes sem cross-check | ausência de registry canônico de verticais | config/qa-waves-registry.json, qa/qa-waves/scenario-store.json, qa-mesh/meshRegistry.json, vertical-templates/service.js, solutionsTemplateService.js, menu.js, platform-readiness.js | FIXED (W4) |
| HARD-010 | Coverage: broadcast de status de domínio para cenários do registry que NUNCA executaram (sem interseção com results); estado inferido por nome pode virar VALIDATED; gate não verifica assertions nem hash chain do meshHistory | atribuição por domínio homogêneo sem `registry ∩ results` | scripts/governance/validate-coverage-gate.js:135-229, qa/coverage/coverageGate.js:79-87, qa-mesh/executionHistoryChain.js | FIXED (W4) |
| HARD-011 | Proof engine: `ok===false`, `diff.valid===false`, `assertion.passed===false` não falham proof; evaluateDigitalTwin OR-logic (PARTIAL conta); hashOnly → hardened:true; readiness-decision-engine não consome blockingGaps do final-proof (rota paralela de `AUTONOMOUS_READY_GO`); generate-self-proving-report heurística `*_GO` + exit 0; sem fingerprint sha256 dos artefatos-fonte (proof não vira STALE se evidência editada) | presença ≠ validade nas bordas | governance/proof-engine/index.js, governance/replay-hardening-engine.js:280-290, governance/shared/readiness-decision-engine.js:148-199, governance/generate-self-proving-report.js:117,130 | FIXED (W5) |
| HARD-012 | Model-driven pipeline é relatório paralelo: inferJourneys filtra templates hard-coded, entityGraph FK calculado e descartado; FKs por heurística de nome (attrMeta.references ignorado); `agentFactoryUsesModelDrivenJourneys: true` auto-atestado; nenhum gate/mesh/wave consome os artefatos | pipeline não integrado ao runtime de QA | api/modules/agent-os/services/model-driven-pipeline.js:111-234, model-introspection-service.js:76-112, run-model-driven-pipeline.js:98 | FIXED (W5) |
| HARD-013 | Seeds `draft_ai` executáveis (filtro só exclui `disabled`); `|| 'system'` nos spec builders de seed; DOMAIN_SEEDS com IDs sintéticos sem lastro (salvos só pelo override downstream) | gate de seed fraco + fallback de tenant | api/services/qaWavesScenarioService.js:958, scripts/qa-waves-execute.js:50, api/services/qa/seeds/*OperationalSeed.js, api/services/qa/seedInferenceService.js | FIXED (W5) |
| HARD-014 | Journey FAQ expõe `sources` internas (qa/qa-waves/scenario-store.json etc.) a usuários PRODUCTION na UI do Academy; DTO do `/api/cognitive/process` devolve `outputs` (step ids + outputs) para qualquer classificação | apresentação não filtrada por classificação | frontend/src/components/academy/JourneyFaqTab.jsx, api/modules/cognitive/routes.js (~:104) | FIXED (W3) |
| HARD-015 | validate-coverage-completeness mapeava para IDs de domínio legados (mercado/clinica/servicos), divergindo do registry canônico → falso api-uncovered pós-canonicalização | mapa hardcoded paralelo ao config/verticals.json | scripts/governance/validate-coverage-completeness.js | FIXED (2026-08-19) |
| HARD-016 | fitness_customer_checkin (jornada crítica) ligada a 12 cenários sintéticos auto-gerados inexistentes no meshRegistry → sem evidência executável possível | links gerados de artefatos platform-readiness nunca promovidos ao mesh | config/journey-scenario-links.json | FIXED (2026-08-19) |
| HARD-017 | validate:stack-versions FAIL: check `backend.version` só aceitava literal `runtime: {`, mas o handler /version enriquece via `payload.runtime = {` (só p/ super_admin, por segurança) | heurística textual do validador mais estrita que o código real | scripts/stack-versions.js:279 | FIXED (2026-08-19) |
| HARD-018 | Seeds RPA com assert final em landmark transitório (`.rap-toast--success` auto-dismiss) → flake sob carga (fitness-matricula-agendamento-ui falhou 1× em 5 na mesma corrida; prova forte já existia no wait `:has-text("Agendamento criado")` do passo anterior) | validação de fim de jornada contra elemento efêmero | rpa/seeds/fitness-matricula-agendamento-ui.json, rpa/seeds/support-inbox-nota-ui.json | FIXED (2026-08-19) |
| HARD-019 | Rotas agent-os resolviam `tenantId`/`actorClassification` ANTES do requireAuth do branch (que é quem popula req) → após W1-A fail-closed, requests autenticadas com tenant passaram a dar 400 tenant_required (6 cenários business-core falharam no mesh); `qa:mesh` não carregava .env → 10 cenários RPA falharam com replay_signing_key_required; cenário agent-factory não aceitava os 400 estruturados novos (agent_not_validated/agent_not_approved) | bug latente de ordenação mascarado pelo fallback `req.tenant_id \|\| 'system'`; script sem --env-file | 7 rotas em api/modules/agent-os/routes/, package.json (qa:mesh), tests/rpa/business/runtime.js | FIXED (2026-08-19) |
| HARD-020 | Teste `api/server.test.js` ("GET endpoints QA Waves com token valido") ficou stale após o hardening fail-closed de `api/middleware/auth.js` (super-admin sem X-Tenant-Id → `req.tenantId = null`): o teste logava sem header e `/api/qa-waves/journeys` respondia 400 tenant_required (por design). Só reproduz com DB vivo (dbReady=true) — no run unit sem DB o teste é skipado | teste não atualizado junto do hardening de tenant | api/server.test.js:338-353 | FIXED (2026-08-19) — teste agora passa `loginAuthHeaders('system')`, alinhado à semântica fail-closed |
| HARD-021 | `buildSnapshotDiff` marcava `valid = Boolean(changed)` — steps read-only/navegação (sem mudança esperada, ex.: step_access_support_module) ficavam `valid:false` e o proof engine semântico (corretamente) reprovava o digital twin (`snapshot_diff_invalid`). Fallback idêntico existia nos 2 runners do final smoke | semântica errada de validade do diff (presença de mudança ≠ validade) | api/services/qa/operationalStepExecutor.js (buildSnapshotDiff), scripts/smoke/qa-waves-operational-final-smoke.js (2 fallbacks) | FIXED (2026-08-19) — valid = sem violação de expectativa (expectedMutations ausentes ou unexpectedMutations presentes); diff agora emite expectedMutations/unexpectedMutations; teste buildSnapshotDiffSemantics 5/5 + regressão 146/146 |
| HARD-022 | Fixture server do final smoke (`technical_fixture`) estava desatualizado em relação ao contrato real de 10 steps do support_ticket_flow: card sem `data-ticket-id`, sem takeover/assign/messages/delivery-failures/status/ticket detail endpoints, sem message-sent/ticket-message-list/close modal/ConfirmDialog → step_open_ticket falhava com support_ticket_card_missing e 7 steps obrigatórios ausentes (journey_required_step_missing); na iteração final faltava estado vazio visível na lista após fechar o ticket (Playwright `waitForSelector` default exige bounding box) | fixture HTML/HTTP congelado numa versão antiga da jornada | scripts/smoke/qa-waves-operational-final-smoke.js (renderSupportPage + createFixtureServer) | FIXED (2026-08-19) — fixture alinhado ao contrato real (10 steps) + empty-state visível; smoke final **status=GO** (ambas as jornadas auditValid=true, strictGovernance=GO, replayGovernance=GO; blockers de productionReadiness são os esperados do modo fixture) |
| HARD-023 | Proof semântico reprovava (corretamente) 2 fontes: (a) prod-like smoke `payment_charge_flow` com blocker `post_state_mutation_without_side_effect` em `step_confirm_membership_payment` — o webhook de confirmação incrementa `events.notifications.count/sent` (recibo ao membro), mas CANONICAL_SIDE_EFFECT_RULES não mapeava `notification_sent` para esse step e o registry declarava `expectedSideEffects: []`; (b) digital twin com `snapshot_expected_mutations_missing:step_assert_ticket_ui` — o step de asserção declara expectedMutations CUMULATIVAS da jornada usando nome não-canônico (`ticket_reply_persisted` vs canônico `message_created`) e o twin não carregava observedMutations | regra canônica ausente + nome de mutação fora do vocabulário canônico + materializador sem observação cumulativa | qa/contracts/operationalStepRegistry.js (expectedSideEffects), qa/evidence/postStateProofValidator.js (2 regras), api/services/qa/journeyStepDefinitions/supportTicketFlowSteps.js (nome canônico), governance/materialize-proof-artifacts.js (observação cumulativa real por jornada + dedupe) | FIXED (2026-08-19) — 6 testes novos (paymentSideEffectAndTwinCumulative); prod-like smoke 8/8 GO com productionReadiness GO/0 blockers; twin com 0 violações |

## CONFORME (auditado, não tocar)

- Cognitive Core: tenant fail-closed em todos os engines (context/intent/planner/execution/router/orchestrator/tool-registry/supervisor).
- Tool Registry: ponto único de autorização real (tenant, visibility, permissões, schema, idempotency, confirmation) — todos os canais internos passam por ele.
- MCP core (auth/client-hub/server-adapter): tenant-scoped `tenant:name`, mismatch explícito, stripTenantOverride — testado.
- Coverage: matemática ≤100% garantida (numerador ⊆ denominador).
- Seeds de banco/operacionais blocking: FKs reais via provisioning, ordem topológica, idempotência.
- RAG segregation: relatório PASS com 0 violações (2026-08-18).
- Visibility policy / experience-segregation: validator PASS.

## Log de execução

| Data | Ação | Resultado |
|------|------|-----------|
| 2026-08-18 | FASE 0 baseline + auditoria 12 frentes | 13 gaps (HARD-001..013), 6 áreas CONFORME |
| 2026-08-19 | HARD-014 adicionado (fontes internas no Academy/DTO cognitivo) | 14 gaps |
| 2026-08-19 | W1-A tenant/principal fail-closed (15 arq. produção, 4 teste; tenantFailClosed 9/9; unit 2884 verde) | HARD-001/002 FIXED |
| 2026-08-19 | W1-B MCP hardening (/mcp montado com auth real; client-hub fail-closed tenant+name; toolId externo com token de tenant; mcpHardening 6/6 + direcionados 56 verdes) | HARD-003 FIXED |
| 2026-08-19 | W2-A Agent Factory (publish exige approved + SoD; approveAgent alcançável; gate 6 re-computa assinatura; RBAC agents:approve/publish; agentFactoryGovernance 16/16) | HARD-008 FIXED |
| 2026-08-19 | W2-B Replay×RPA (ensureRpaDevelopmentAccess; /rpa-replays SUPPORT no menu; visibility-policy PASS; replayRpaSegregation 14/14) | HARD-007 FIXED |
| 2026-08-19 | W3 outcome contracts (planner rejeita sideEffects sem contrato; evidência por step da requiredAction; handoff vira agent.execution.handed_off; DTO operacional sem outputs p/ PRODUCTION; 26 testes novos) | HARD-004/005/006/014 FIXED |
| 2026-08-19 | W4 verticais canônicas (config/verticals.json + validate:vertical-registry na cadeia do gate; coverage: broadcast restrito a results reais, inferido ≤ VISITED, verifyChain fail-closed; coverageGateEvidence 6/6; coverage-gate GO) | HARD-009/010 FIXED |
| 2026-08-19 | W5 proof semântico (semanticArtifactViolations; digital twin AND; hashOnly ≠ hardened; readiness consome blockingGaps; self-proving exit não-zero; fingerprint-chain STALE; seeds draft_ai hard-fail + tenant_required; 8 suites novas) | HARD-011/013 FIXED |
| 2026-08-19 | Fallback remanescente agent-orchestrator.js:141 eliminado (padrão W1-A) + teste; teste verticalRegistry (7/7) cobre "vertical registry duplicate" da FASE 23 | reforço HARD-001/009 |
| 2026-08-19 | HARD-012 fechado na W5 (commit df07558d): FKs via metadata Sequelize real, inferJourneys consome entityGraph, flag de integração derivada de invocação real | HARD-012 FIXED (14/14 gaps) |
| 2026-08-19 | Regressão completa: unit 540 suites/3020 testes, test:system 84/84, FASE 24 integrações 7/7, vitest frontend 34/34, smoke production_health GO, replay-integrity 8 replays/0 issues | verde |
| 2026-08-19 | Falha ambiental: ENOSPC (disco 100%) derrubou API dev e causou ERR_INSUFFICIENT_RESOURCES rotativo no validate:runtime; mitigado com poda de tests/rpa/{screenshots,reports} (gitignored) liberando ~2G | ambiental, sem regressão de código |
| 2026-08-19 | HARD-015 (pós-W4): validate-coverage-completeness mapeava módulos/rotas para IDs legados (mercado/clinica/servicos) → falso `api-uncovered` de market-intelligence após canonicalização. Fix: canonicalDomain via config/verticals.json em rotas/módulos/cenários/capabilities; teste coverageCompletenessCanonicalDomains 3/3 | FIXED |
| 2026-08-19 | HARD-016 (exposto pelo HARD-010): journey crítica fitness_customer_checkin ligada a 12 IDs sintéticos auto-gerados ausentes do meshRegistry → imvalidável. Fix: religada a business-fit-flow-checkin (execução real passed com 3 assertions) com manual:true; links sintéticos removidos | FIXED |
| 2026-08-19 | Evidência fresca: wave reports regenerados (db-integrity/api-surface/page-surface exit 0) e mesh completo reexecutado para registrar assertions do registry nos cenários scr-* | em curso |
| 2026-08-19 | api-surface: isenções authEnforced auditáveis para GET /health e /health/live (liveness público por design, sem dados de tenant) → FAILED=0 (750 VALIDATED, 3 VISITED em POSTs RPA por política de probe) | FIXED |
| 2026-08-19 | HARD-017: validate:stack-versions FAIL pré-existente — heurística `runtime: {` não reconhecia `payload.runtime = {` do handler /version (enriquecimento privilegiado intencional). Fix no validador; endpoint inalterado | FIXED |
| 2026-08-19 | HARD-018: flake fitness-matricula-agendamento-ui diagnosticado (passou 4× e falhou 1× na mesma corrida): assert final em `.rap-toast--success` (toast auto-dismiss). Fix: landmark persistente (card da tarefa / nota no thread) em 2 seeds RPA; prova semântica forte permanece no wait do toast no passo anterior | FIXED |
| 2026-08-19 | Mesh completo pós-hardening: 131 executados, 113 passed, 15 failed, 3 flaky → NO_GO. Diagnóstico: (1) HARD-019 — tenantId/actorClassification resolvidos antes do requireAuth em 7 rotas agent-os (bug latente exposto pela W1-A); (2) qa:mesh sem --env-file → replay_signing_key_required nos 10 cenários RPA; (3) cenário agent-factory sem contrato para agent_not_validated/agent_not_approved. Fixes aplicados + teste agentOsTenantLazyResolution 2/2 + verificação curl no runtime real (install 201, cleanup 200) | FIXED |
| 2026-08-19 | Rerun dirigido (18 cenários: 15 failed + 3 flaky da corrida NO_GO): 17/17 passed com assertions (evidência mesh-2026-08-19T10-52-07-656Z) + qa-core-auth-login passed (mesh-2026-08-19T11-09-29-476Z). Coverage gate regenerado: GO (exit 0, zero bloqueios). HARD-020: server.test.js stale pós-hardening de auth (super-admin sem X-Tenant-Id → tenant_required por design); teste agora passa header explícito, suíte 33/33 | FIXED |
| 2026-08-19 | validate:governance-enforcement falhou em validate:qa-governance: o go-no-go canônico ainda apontava a corrida NO_GO (15 falhas). Rerun parcial atualiza meshHistory por cenário (o mais recente vence no coverage gate), mas o relatório canônico exige corrida full com RUNNING_IN_PIPELINE=1 sem filtros → corrida canônica full relançada | em curso |

## Relatório final (FASE 28)

### Arquitetura final (cadeia canônica)

```
Channel (REST/WhatsApp/UI)
→ Canonical Principal/Tenant (fail-closed: TENANT_REQUIRED/PRINCIPAL_REQUIRED)
→ Cognitive Core (context→intent→planner→execution→validation→learning)
→ Agent Supervisor
→ Action Planner (sideEffects/MUTATION exigem Outcome Contract)
→ Autorização canônica única (Tool Registry; MCP tenant-scoped tenant:name)
→ Execution Engine
→ Validation (businessOutcome.valid participa do evento)
→ Business Outcome (evidência por step da requiredAction)
→ Evidence Plane (classificado: PRODUCTION vê Outcome DTO; SUPPORT/DEVELOPMENT veem internals)
→ Learning Core (eventos semânticos: handed_off ≠ completed)
```

### Segregação de experiências

- PRODUCTION: menu/páginas sem QA/RPA internals; DTO cognitivo sem `outputs`/steps; Academy sem `sources` internas.
- SUPPORT: Replay/leitura RPA (`ensureReplaySupportAccess`), gravação negada.
- DEVELOPMENT: QA Waves/Mesh, Seeds, RPA Lab, gravação/execução técnica (`ensureRpaDevelopmentAccess`).
- Backend: `requireClassification` em todas as rotas de engenharia — menu oculto nunca é a proteção.

### Segurança

- Tenant isolation: `report:tenant-isolation` (suítes Jest de tenant) sem violações.
- MCP: conexões resolvidas por tenant+name; cross-tenant negado (testes mcpHardening 6/6).
- RAG: OPERATIONAL/SYSTEM segregados, relatório PASS 0 violações; domínio nunca vem do payload.
- Agent Factory: publish exige lifecycle `approved` + aprovação auditável (SoD), RBAC agents:approve/publish.

### Falhas ambientais encontradas durante o trabalho

1. ENOSPC (disco 100%) derrubou a API dev → ERR_INSUFFICIENT_RESOURCES rotativo no validate:runtime. Mitigado: poda de artefatos transitórios gitignored (tests/rpa/{screenshots,reports} ≈ 2G) e restart da API. Sem regressão de código.
2. Wave reports de 2026-08-14 (pré-hardening) degradaram a cobertura VALIDATED → regenerados contra a stack viva.

### Números finais dos gates

_(preenchidos após a execução final do gate agregado — ver log de execução acima)_

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
| HARD-001 | Tenant fallback `|| 'system'` em módulos Agent OS/registry, learning-core, support-debug, executionQueue | `req.tenant_id` (snake_case) nunca é populado; middlewares setam `req.tenantId` — fallback dispara 100% das vezes | api/modules/agent-os/routes/*.js, api/modules/agent-registry/routes.js, api/modules/learning-core/routes.js, api/modules/support-debug/routes.js, api/services/executionQueueService.js | OPEN |
| HARD-002 | Principal fallback `req.user?.username \|\| 'system'` — `req.user` nunca é populado; approvedBy/actor sempre 'system' | requireAuth popula `req.agent`, não `req.user` | agent-factory.js:112,218,246; agent-orchestrator.js:256 | OPEN |
| HARD-003 | MCP HTTP boundary: `POST /mcp` sem requireAuth (401 permanente = inoperante), tenant `|| 'system'`, sem resolveActorToolPermissions, rota nunca montada; fallback por nome em client-hub.getConnection; toolId externo sem tenant | bootstrap Express fora do pipeline de auth | api/runtime/startMcpServer.js, src/core/mcp/client-hub.js:65-70, src/core/mcp/external-tool-adapter.js:88, api/server.js:173-191 | OPEN |
| HARD-004 | Mutation sem Outcome Contract completa como sucesso (ex.: `consultar_metricas`→`workspace.generateInsight` sideEffects:true sem contrato); evidência = presença de campo de qualquer step; `failureIfDenied` morto; contrato `messaging.send` órfão; sem classificação READ_ONLY/MUTATION | planner não vincula tool.sideEffects → contrato obrigatório | src/core/cognitive/outcome/index.js, action-planner/index.js, tool-registry/index.js | OPEN |
| HARD-005 | `agent.execution.completed` ignora `businessOutcome.valid` (isSuccess só olha status técnico) | mapeamento de evento pré-outcome | cognitive-orchestrator/index.js:343-363 | OPEN |
| HARD-006 | `human_handoff_requested` → `agent.execution.completed` + `business.outcome.failed` contraditório; learning-engine emite `cognitive.execution.failed` para o mesmo handoff | taxonomia sem evento de handoff | cognitive-orchestrator/index.js:227,343-348,388; learning-engine/index.js:46-51; api/events/eventModelV1.js:87-101 | OPEN |
| HARD-007 | RPA gravação/execução técnica acessível a SUPPORT (guard único `ensureSupportAccess`); divergência SUPPORT_VISIBLE_ROUTES vs frontend (`/rpa-replays`) | guard único para replay (leitura) e RPA (escrita técnica) | api/modules/rpa-tests/rpaRouteUtils.js, handleRpaRecordingsRoutes.js, handleRpaExecutionRoutes.js, experience-segregation.js, menuPermissions.js | OPEN |
| HARD-008 | Agent Factory: publish não exige `approved`, auto-approval (`approvedBy`=actor do publish), approve inalcançável (gate 4 exige approvedBy antes de existir), gates por presença (waveId/evidenceId strings), RBAC sem agents:approve/publish para papéis, actorRole hardcoded 'super_admin' | validateAndPublishAgent não lê lifecycle; gate order invertido | agent-hardening-service.js:389-528, agent-factory.js, rbacService.js | OPEN |
| HARD-009 | Verticais sem fonte canônica: `mercado` vs `market` no meshRegistry/scenario-store; alias `mercado→market` ausente em domainAliases; templates usam `retail`, readiness usa `market`; 4+ listas independentes sem cross-check | ausência de registry canônico de verticais | config/qa-waves-registry.json, qa/qa-waves/scenario-store.json, qa-mesh/meshRegistry.json, vertical-templates/service.js, solutionsTemplateService.js, menu.js, platform-readiness.js | OPEN |
| HARD-010 | Coverage: broadcast de status de domínio para cenários do registry que NUNCA executaram (sem interseção com results); estado inferido por nome pode virar VALIDATED; gate não verifica assertions nem hash chain do meshHistory | atribuição por domínio homogêneo sem `registry ∩ results` | scripts/governance/validate-coverage-gate.js:135-229, qa/coverage/coverageGate.js:79-87, qa-mesh/executionHistoryChain.js | OPEN |
| HARD-011 | Proof engine: `ok===false`, `diff.valid===false`, `assertion.passed===false` não falham proof; evaluateDigitalTwin OR-logic (PARTIAL conta); hashOnly → hardened:true; readiness-decision-engine não consome blockingGaps do final-proof (rota paralela de `AUTONOMOUS_READY_GO`); generate-self-proving-report heurística `*_GO` + exit 0; sem fingerprint sha256 dos artefatos-fonte (proof não vira STALE se evidência editada) | presença ≠ validade nas bordas | governance/proof-engine/index.js, governance/replay-hardening-engine.js:280-290, governance/shared/readiness-decision-engine.js:148-199, governance/generate-self-proving-report.js:117,130 | OPEN |
| HARD-012 | Model-driven pipeline é relatório paralelo: inferJourneys filtra templates hard-coded, entityGraph FK calculado e descartado; FKs por heurística de nome (attrMeta.references ignorado); `agentFactoryUsesModelDrivenJourneys: true` auto-atestado; nenhum gate/mesh/wave consome os artefatos | pipeline não integrado ao runtime de QA | api/modules/agent-os/services/model-driven-pipeline.js:111-234, model-introspection-service.js:76-112, run-model-driven-pipeline.js:98 | OPEN |
| HARD-013 | Seeds `draft_ai` executáveis (filtro só exclui `disabled`); `|| 'system'` nos spec builders de seed; DOMAIN_SEEDS com IDs sintéticos sem lastro (salvos só pelo override downstream) | gate de seed fraco + fallback de tenant | api/services/qaWavesScenarioService.js:958, scripts/qa-waves-execute.js:50, api/services/qa/seeds/*OperationalSeed.js, api/services/qa/seedInferenceService.js | OPEN |

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

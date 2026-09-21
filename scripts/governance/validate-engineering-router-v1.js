#!/usr/bin/env node
'use strict';

/**
 * validate-engineering-router-v1.js — gate ENGINEERING_ROUTER_V1.
 *
 * Valida estaticamente (sem depender de banco/rede) que os componentes obrigatórios do
 * Engineering Model Router V1 existem e estão coerentes: reuso do registry de IA existente,
 * classificação DEVELOPMENT, state machine, roteamento, independência de reviewer, redação de
 * segredo, escopo de patch, teste determinístico, loop de fix, review, telemetria e montagem
 * real das rotas UI/API.
 *
 * Saída: reports/engineering-router-v1-report.json.
 */

const fs = require('fs');
const path = require('path');
const { ROOT, writeReport, exists, readText } = require('./common');

function checkFileContains(relPath, patterns) {
  if (!exists(relPath)) return { ok: false, reason: `arquivo ausente: ${relPath}` };
  const content = readText(relPath);
  for (const p of patterns) {
    if (!p.test(content)) return { ok: false, reason: `padrão ausente em ${relPath}: ${p}` };
  }
  return { ok: true };
}

function main() {
  const checks = [];

  // 1. Reuso do registry/control plane existentes — NÃO deve existir um registry paralelo.
  checks.push({
    id: 'EXISTING_INFRA_REUSE',
    ...checkFileContains('engine/engineeringRouter/modelCapabilities.js', [
      /require\('\.\/constants'\)/,
      /getModelCapability/,
    ]),
  });
  checks.push({
    id: 'NO_PARALLEL_PROVIDER_REGISTRY',
    ok: !exists('engine/engineeringRouter/providerRegistry.js') && !exists('api/services/engineeringRouter/engineeringProviderRegistry.js'),
    reason: 'nenhum EngineeringProviderRegistry paralelo deve existir',
  });
  checks.push({
    id: 'AI_CONTROL_PLANE_REUSE',
    ...checkFileContains('api/services/engineeringRouter/engineeringAiInvoker.js', [
      /getProviderInstance/,
    ]),
  });

  // 2. EngineeringTask persistente + state machine.
  checks.push({ id: 'ENGINEERING_TASK_MODEL', ok: exists('api/db/models/EngineeringTask.js'), reason: 'model EngineeringTask ausente' });
  checks.push({ id: 'ENGINEERING_TASK_MIGRATION', ok: fs.readdirSync(path.join(ROOT, 'api/db/migrations')).some((f) => f.includes('create-engineering-router-v1')), reason: 'migration do Engineering Router ausente' });
  checks.push({
    id: 'STATE_MACHINE',
    ...checkFileContains('engine/engineeringRouter/stateMachine.js', [/assertTransition/, /INVALID_STATE_TRANSITION/]),
  });

  // 3. Classifier + policy versionada.
  checks.push({ id: 'TASK_CLASSIFIER', ...checkFileContains('engine/engineeringRouter/taskClassifier.js', [/CLASSIFIER_VERSION/, /overridesRespected/]) });
  checks.push({ id: 'ROUTING_POLICY', ...checkFileContains('engine/engineeringRouter/routingPolicy.js', [/POLICY_VERSION/, /requiresIndependentReview/]) });

  // 4. Model routing + independência de reviewer.
  checks.push({
    id: 'MODEL_ROUTING_INDEPENDENCE',
    ...checkFileContains('engine/engineeringRouter/modelSelector.js', [
      /INDEPENDENT_PROVIDER_APPLIED/,
      /INDEPENDENT_PROVIDER_UNAVAILABLE/,
    ]),
  });

  // 5. Context builder + secret redaction.
  checks.push({ id: 'CONTEXT_BUILDER', ok: exists('api/services/engineeringRouter/contextBuilderService.js'), reason: 'contextBuilderService ausente' });
  checks.push({
    id: 'SECRET_REDACTION',
    ...checkFileContains('engine/engineeringRouter/secretRedaction.js', [/BLOCKED_FILENAME_PATTERNS/, /applySecretPolicy/]),
  });
  // ERV1-CLOSE-003: redação de blocos multiline (chave privada) precisa rodar sobre o CONTEÚDO
  // INTEIRO antes de qualquer split em linhas — nunca reintroduzir "content.split('\n')" antes
  // da redação de bloco.
  checks.push({
    id: 'SECRET_REDACTION_MULTILINE',
    ...checkFileContains('engine/engineeringRouter/secretRedaction.js', [/MULTILINE_BLOCK_PATTERNS/, /redactBlockSecrets/, /redactText/]),
  });

  // 6. Patch real + validação + path boundary + controlled apply.
  checks.push({
    id: 'PATCH_VALIDATOR',
    ...checkFileContains('engine/engineeringRouter/patchValidator.js', [/PATCH_INVALID_FORMAT/, /PATCH_OUTSIDE_ALLOWED_SCOPE/]),
  });
  checks.push({
    id: 'PATH_BOUNDARY',
    ...checkFileContains('engine/engineeringRouter/pathBoundary.js', [/checkPathBoundary/]),
  });
  checks.push({
    id: 'CONTROLLED_APPLY',
    ...checkFileContains('api/services/engineeringRouter/patchApplyService.js', [/git worktree/i, /createWorkspace/, /destroyWorkspace/, /normalizeHunkHeaders/]),
  });
  // Achado real do pilot V1: LLMs erram a contagem do header do hunk com frequência —
  // git apply rejeita como "corrompido" mesmo com conteúdo correto. Robustez obrigatória.
  checks.push({
    id: 'HUNK_COUNT_ROBUSTNESS',
    ...checkFileContains('engine/engineeringRouter/hunkNormalizer.js', [/normalizeHunkHeaders/]),
  });

  // 7. Test runner determinístico + allowlist de comando.
  checks.push({
    id: 'DETERMINISTIC_TEST_RUNNER',
    ...checkFileContains('api/services/engineeringRouter/testRunnerService.js', [/exitCode/i, /runTestCommands/]),
  });
  checks.push({
    id: 'COMMAND_POLICY',
    ...checkFileContains('engine/engineeringRouter/commandPolicy.js', [/DANGEROUS_PATTERNS/, /DEFAULT_ALLOWED_PREFIXES/]),
  });
  // ERV1-CLOSE-001: fronteira real é shell:false + executable/args estruturados, nunca uma
  // string inteira passada a um shell. `parseCommand` é a única fonte de {executable,args}; se
  // "shell: true" reaparecer neste arquivo, é uma regressão de segurança grave.
  checks.push({
    id: 'NO_SHELL_TRUE_TEST_RUNNER',
    ok: exists('api/services/engineeringRouter/testRunnerService.js')
      && !/shell:\s*true/.test(readText('api/services/engineeringRouter/testRunnerService.js')),
    reason: 'testRunnerService.js não pode usar shell:true (ERV1-CLOSE-001 — regressão de command injection)',
  });
  checks.push({
    id: 'STRUCTURED_COMMAND_EXECUTION',
    ...checkFileContains('api/services/engineeringRouter/testRunnerService.js', [/parseCommand/, /shell:\s*false/]),
  });
  checks.push({
    id: 'COMMAND_POLICY_SHELL_METACHAR_BLOCK',
    ...checkFileContains('engine/engineeringRouter/commandPolicy.js', [/FORBIDDEN_SHELL_CHARS_RE/, /parseCommand/, /validateStructuredCommand/]),
  });
  // ERV1-CLOSE-002: nunca reintroduzir `{...process.env}` no Test Runner — env sandboxed é a
  // fronteira contra vazamento de segredo real do processo pai via subprocess de teste.
  checks.push({
    id: 'NO_FULL_ENV_PASSTHROUGH_TEST_RUNNER',
    ok: exists('api/services/engineeringRouter/testRunnerService.js')
      && !/\.\.\.process\.env/.test(readText('api/services/engineeringRouter/testRunnerService.js')),
    reason: 'testRunnerService.js não pode passar {...process.env} para subprocess (ERV1-CLOSE-002 — vazamento de segredo)',
  });
  checks.push({
    id: 'SAFE_TEST_ENVIRONMENT',
    ...checkFileContains('api/services/engineeringRouter/safeEngineeringEnvironment.js', [/SAFE_ENV_PASSTHROUGH_KEYS/, /buildSafeTestEnv/]),
  });
  checks.push({
    id: 'TEST_OUTPUT_REDACTION',
    ...checkFileContains('api/services/engineeringRouter/testRunnerService.js', [/redactText/]),
  });

  // ERV1-CLOSE-006: credencial de IA do Engineering nunca pode vir do tenant de quem chama a
  // API — só a audiência de evento WebSocket pode. Se "credentialScope"/"tenantId" reaparecer
  // no handler de /run vindo de req.agent/req.tenantId, é uma regressão de isolamento de tenant.
  checks.push({
    id: 'CREDENTIAL_SCOPE_ISOLATION',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /ENGINEERING_CREDENTIAL_SCOPE/,
      /credentialScope/,
      /eventAudienceTenantId/,
    ]),
  });
  checks.push({
    id: 'ROUTE_NEVER_PASSES_CALLER_TENANT_AS_CREDENTIAL_SCOPE',
    ok: exists('api/modules/engineering-router/routes.js')
      && /eventAudienceTenantId/.test(readText('api/modules/engineering-router/routes.js'))
      && !/credentialScope\s*:/.test(readText('api/modules/engineering-router/routes.js')),
    reason: 'routes.js não pode passar credentialScope: <valor> ao chamar runTask — só eventAudienceTenantId (ERV1-CLOSE-006)',
  });

  // 8. RED->FIX loop + max iterations.
  checks.push({
    id: 'RED_FIX_LOOP',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /ENGINEERING_TASK_EXHAUSTED/,
      /RETRY/,
    ]),
  });
  // ERV1-CLOSE-008: provider saudável (breaker fechado) não implica modelId válido — reroute
  // real dentro da MESMA task quando um modelo específico falha, em vez de FATAL/RED imediato.
  checks.push({
    id: 'MODEL_LEVEL_AVAILABILITY',
    ...checkFileContains('api/services/engineeringRouter/modelAvailabilityStore.js', [
      /AVAILABILITY_STATES/, /markUnavailable/, /isUsable/, /classifyModelFailure/,
    ]),
  });
  checks.push({
    id: 'MODEL_REROUTE_WITHIN_TASK',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /outcome === 'REROUTE'/, /excludedModelKeys/, /NO_ALTERNATIVE_CANDIDATE/,
    ]),
  });
  checks.push({
    id: 'MODEL_SELECTOR_RESPECTS_AVAILABILITY',
    ...checkFileContains('engine/engineeringRouter/modelSelector.js', [/model\.available/, /excludedModelKeys/]),
  });

  // ERV1-CLOSE-009: lock de execução precisa ser adquirido de forma SÍNCRONA antes de responder
  // à requisição HTTP — nunca fire-and-forget do lock em si (só a execução longa pode ser
  // fire-and-forget). Achado real: routes.js chamava runTask sem await, então uma segunda
  // chamada concorrente sempre recebia 202 mesmo quando TASK_ALREADY_RUNNING acontecia.
  checks.push({
    id: 'RESTART_SAFE_LOCK',
    ...checkFileContains('api/services/engineeringRouter/engineeringTaskService.js', [/LOCK_STALE_MS/, /TASK_ALREADY_RUNNING/, /lock:\s*t\.LOCK\.UPDATE/]),
  });
  checks.push({
    id: 'CONCURRENCY_SAFE_ROUTE',
    ok: exists('api/services/engineeringRouter/engineeringRouterService.js')
      && /beginRun/.test(readText('api/services/engineeringRouter/engineeringRouterService.js'))
      && exists('api/modules/engineering-router/routes.js')
      && /await deps\.engineeringRouterService\.beginRun/.test(readText('api/modules/engineering-router/routes.js')),
    reason: 'routes.js precisa aguardar (await) beginRun antes de responder — nunca disparar o lock em fire-and-forget (ERV1-CLOSE-009)',
  });
  checks.push({
    id: 'ORPHAN_WORKSPACE_PRUNING',
    ...checkFileContains('api/services/engineeringRouter/patchApplyService.js', [/pruneOrphanedWorkspaces/]),
  });

  // 9. Review loop independente.
  checks.push({
    id: 'REVIEW_LOOP',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [/REVIEWING/, /decision === 'REJECT'/]),
  });

  // ERV1-CLOSE-004: REGRESSION/GOVERNANCE precisam ser checagens REAIS capazes de reprovar —
  // nunca transições de status decorativas. Achado real: antes desta correção, GREEN só exigia
  // status=GOVERNANCE sem nenhuma evidência checada.
  checks.push({
    id: 'REAL_REGRESSION_CHECK',
    ...checkFileContains('api/services/engineeringRouter/regressionGovernanceService.js', [/checkRegression/, /listTestRuns/]),
  });
  checks.push({
    id: 'REAL_GOVERNANCE_CHECK',
    ...checkFileContains('api/services/engineeringRouter/regressionGovernanceService.js', [/checkGovernance/, /validate-engineering-router-v1/]),
  });
  checks.push({
    id: 'REGRESSION_GOVERNANCE_CAN_FAIL',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /REGRESSION_FAILED/,
      /GOVERNANCE_FAILED/,
      /regressionResult\.pass/,
      /governanceResult\.pass/,
    ]),
  });

  // 10. Telemetria básica.
  checks.push({ id: 'TELEMETRY_MODEL', ok: exists('api/db/models/EngineeringTelemetryEvent.js'), reason: 'model de telemetria ausente' });

  // 11. DEVELOPMENT segregation (backend real, não apenas frontend).
  checks.push({
    id: 'DEVELOPMENT_SEGREGATION_BACKEND',
    ...checkFileContains('api/modules/engineering-router/routes.js', [/checkClassification/, /'DEVELOPMENT'/]),
  });

  // 12. Rotas realmente montadas (não só declaradas) — mesma checagem usada por validate-route-mounts.
  const registerRoutesSrc = readText('api/app/registerRoutes.js');
  const routeRegistrySrc = readText('api/app/routeRegistry.js');
  checks.push({
    id: 'ROUTE_MOUNTED',
    ok: /createEngineeringRouterExpressRouter/.test(registerRoutesSrc) && /engineeringRouterRouter/.test(routeRegistrySrc),
    reason: 'router do Engineering não está registrado em registerRoutes.js/routeRegistry.js',
  });

  // 13. UI — 5 telas + registro em main.jsx/menu.js.
  const uiPages = [
    'frontend/src/pages/EngineeringOverviewPage.jsx',
    'frontend/src/pages/EngineeringTasksPage.jsx',
    'frontend/src/pages/EngineeringTaskDetailPage.jsx',
    'frontend/src/pages/EngineeringModelsPage.jsx',
    'frontend/src/pages/EngineeringReleaseClosurePage.jsx',
  ];
  for (const page of uiPages) {
    checks.push({ id: `UI_${path.basename(page, '.jsx').toUpperCase()}`, ok: exists(page), reason: `${page} ausente` });
  }
  checks.push({
    id: 'UI_ROUTED_IN_MAIN',
    ok: /EngineeringOverviewPage/.test(readText('frontend/src/main.jsx')) && /isEngineeringOverview/.test(readText('frontend/src/main.jsx')),
    reason: 'páginas Engineering não roteadas em main.jsx',
  });
  checks.push({
    id: 'UI_MENU_ENTRY',
    ok: /dev-engineering/.test(readText('frontend/src/navigation/menu.js')),
    reason: 'entrada de menu Engineering ausente',
  });

  // 14. Testes: unit/contract/integration/E2E presentes.
  const testFiles = [
    'tests/unit/engineeringRouterConstants.test.js',
    'tests/unit/engineeringRouterModelSelector.test.js',
    'tests/unit/engineeringTaskModel.test.js',
    'tests/unit/engineeringRouterRoutes.test.js',
    'tests/contracts/engineeringCoderReviewerService.test.js',
    'tests/integration/engineeringPatchApplyAndTestRunner.test.js',
    'tests/unit/engineeringRouterHunkNormalizer.test.js',
    'tests/integration/engineeringRouterFullLoopE2E.test.js',
    'tests/unit/engineeringModelAvailabilityService.test.js',
    'tests/unit/engineeringRouterCommandExecutionSecurity.test.js',
    'tests/unit/engineeringRouterSafeEnvironment.test.js',
    'tests/unit/engineeringRouterSecretRedactionMultiline.test.js',
    'tests/integration/engineeringRouterModelRerouteE2E.test.js',
    'tests/integration/engineeringTaskConcurrencyAndRestart.test.js',
    'tests/integration/engineeringRouterOrphanWorkspacePruning.test.js',
    'tests/integration/engineeringRegressionGovernanceService.test.js',
    'tests/integration/engineeringRouterRegressionGovernanceGate.test.js',
  ];
  for (const f of testFiles) {
    checks.push({ id: `TEST_${path.basename(f)}`, ok: exists(f), reason: `${f} ausente` });
  }

  // 15. Documentação V1.
  const docs = [
    'docs/architecture/ENGINEERING_MODEL_ROUTER_V1.md',
    'docs/architecture/ENGINEERING_MODEL_ROUTER_ARCHITECTURE.md',
    'docs/architecture/ENGINEERING_MODEL_ROUTER_SECURITY.md',
    'docs/architecture/ENGINEERING_MODEL_ROUTER_OPERATIONS.md',
    'docs/architecture/ENGINEERING_MODEL_ROUTER_UI.md',
    'docs/architecture/ENGINEERING_MODEL_ROUTER_MANUAL.md',
    'POST_RELEASE_MODEL_ROUTER_BACKLOG.md',
  ];
  for (const d of docs) {
    checks.push({ id: `DOC_${path.basename(d, '.md')}`, ok: exists(d), reason: `${d} ausente` });
  }

  const failed = checks.filter((c) => !c.ok);
  const report = {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    decision: failed.length === 0 ? 'ENGINEERING_ROUTER_V1_GO' : 'ENGINEERING_ROUTER_V1_GAPS',
    artifactType: 'engineering-router-v1-report',
    artifactVersion: '1.0.0',
    totalChecks: checks.length,
    failedChecks: failed.length,
    checks,
  };

  writeReport('engineering-router-v1-report.json', report);

  console.log(`[engineering-router-v1] status=${report.status} checks=${checks.length} falhas=${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(` - ${f.id}: ${f.reason}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main();

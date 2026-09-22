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
const { ROOT, writeReport, exists, readText, readJson } = require('./common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

// ERV1-CLOSE-010 (Runtime certification): os IDs abaixo têm que bater exatamente com
// `RUNTIME_ITEMS` em collect-engineering-router-runtime-evidence.js — mesma lista, autoridade
// única, nunca duplicada com valores divergentes.
const REQUIRED_RUNTIME_ITEM_IDS = Object.freeze([
  'SHELL_INJECTION_REJECTED',
  'SAFE_ENVIRONMENT',
  'SECRET_REDACTION_MULTILINE',
  'PATCH_PATH_BOUNDARIES',
  'ACTUAL_PATCH_APPLY',
  'DETERMINISTIC_FAILING_TEST_RED',
  'RED_TO_FIX',
  'INDEPENDENT_REVIEW',
  'REVIEWER_REJECTION_RECODE',
  'REGRESSION_EXECUTION',
  'GOVERNANCE_EXECUTION',
  'PROVIDER_MODEL_FAILURE_REROUTE',
  'RESTART_RESUME',
  'CRASH_RESUME_MID_STAGE',
  'CONTROLLED_PROMOTION',
  'POST_PROMOTION_VERIFICATION',
  'EXACT_PATCH_PROMOTION',
  'FAIL_CLOSED_SCOPE',
  'DEVELOPMENT_AUTHORIZATION',
  'PRODUCTION_DENIAL',
  'SUPPORT_DENIAL_DEFAULT',
  'TENANT_CREDENTIAL_ISOLATION',
  'RELEASE_CLOSURE_SAME_RUN_INTEGRITY',
  'EXECUTION_SANDBOX_ISOLATION',
  'MODEL_CATALOG_GOVERNANCE',
]);

/**
 * ERV1-CLOSE-010: gate must FAIL se a evidência de runtime estiver ausente, velha (fingerprint
 * de outra versão do código) ou com qualquer item de exitCode != 0 — nunca aceitar "já rodou algum
 * dia" como prova de comportamento atual. Cada item aqui vira um `check` normal, entrando no
 * mesmo `failed`/`status` do restante do gate (nunca uma categoria "best effort" separada que
 * pode ser ignorada).
 */
function buildRuntimeChecks() {
  const runtimeChecks = [];
  const evidence = readJson('reports/engineering-router-v1-runtime-evidence.json');

  if (!evidence) {
    runtimeChecks.push({
      id: 'RUNTIME_EVIDENCE_PRESENT',
      ok: false,
      reason: 'reports/engineering-router-v1-runtime-evidence.json ausente — rode `node scripts/governance/collect-engineering-router-runtime-evidence.js` antes do gate (ERV1-CLOSE-010: sem evidência de runtime, o gate nunca pode aprovar)',
    });
    for (const id of REQUIRED_RUNTIME_ITEM_IDS) {
      runtimeChecks.push({ id: `RUNTIME_${id}`, ok: false, reason: 'evidência de runtime ausente' });
    }
    return runtimeChecks;
  }

  const currentFingerprint = computeSourceFingerprint(ROOT);
  const isFresh = evidence.sourceFingerprint === currentFingerprint;
  runtimeChecks.push({
    id: 'RUNTIME_EVIDENCE_FRESH',
    ok: isFresh,
    reason: isFresh
      ? undefined
      : `evidência de runtime é de outra versão do código (sourceFingerprint divergente) — evidência: ${evidence.sourceFingerprint?.slice(0, 16)}…, atual: ${currentFingerprint.slice(0, 16)}… (rode o coletor de novo)`,
  });

  const byId = new Map((evidence.items || []).map((i) => [i.id, i]));
  for (const id of REQUIRED_RUNTIME_ITEM_IDS) {
    const item = byId.get(id);
    if (!item) {
      runtimeChecks.push({ id: `RUNTIME_${id}`, ok: false, reason: `item de evidência de runtime ausente: ${id}` });
      continue;
    }
    // ER-V1-FINAL-007 (Evidence Precision): exitCode===0 sozinho não prova nada — `npx jest -t
    // "<padrão sem match>"` também sai com exitCode 0 (tudo "pulado"). A prova real exige
    // testCaseId presente (mira granular por nome, não por arquivo inteiro) e pelo menos um
    // teste com PASS genuíno (numPassedTests>=1), sem nenhuma falha.
    const hasTestCaseId = typeof item.testCaseId === 'string' && item.testCaseId.length > 0;
    const hasRealPass = Number(item.numPassedTests) >= 1 && Number(item.numFailedTests) === 0;
    const itemOk = isFresh && item.exitCode === 0 && hasTestCaseId && hasRealPass;
    let reason;
    if (!isFresh) {
      reason = 'evidência de runtime obsoleta (ver RUNTIME_EVIDENCE_FRESH)';
    } else if (item.exitCode !== 0) {
      reason = `${item.testPath}: exitCode real ${item.exitCode} (não é 0)`;
    } else if (!hasTestCaseId) {
      reason = `${item.testPath}: testCaseId ausente na evidência (mira granular por nome não confirmada)`;
    } else if (!hasRealPass) {
      reason = `${item.testPath}: numPassedTests=${item.numPassedTests}, numFailedTests=${item.numFailedTests} (precisa >=1 passado e 0 falhado)`;
    }
    runtimeChecks.push({ id: `RUNTIME_${id}`, ok: itemOk, reason });
  }

  return runtimeChecks;
}

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
  // ERV1-CLOSE-010 (teste adversarial de segurança): achado real — `checkPathBoundary` fazia
  // match do glob de allowedPaths via string crua, sem nunca resolver segmentos `..`. Um path
  // como `<escopo>/../../../etc/passwd` batia no glob `<escopo>/**` (o `**` "engolia" o
  // `../../../etc/passwd` como texto) e retornava `ok:true` para um escape real da árvore
  // autorizada. `git apply` de fato rejeita qualquer path com `..` (defesa em profundidade
  // incidental), mas o boundary check em si — a autoridade que o Task Contract afirma garantir —
  // dava falso-positivo. Corrigido resolvendo `..`/`.` antes de qualquer match de glob.
  checks.push({
    id: 'PATH_BOUNDARY_TRAVERSAL_RESOLVED',
    ...checkFileContains('engine/engineeringRouter/pathBoundary.js', [/resolvePathSegments/, /PATH_ESCAPES_ROOT/]),
  });
  // ER-V1-FINAL-003 — Fail-Closed Scope: allowedPaths vazio/ausente NUNCA mais significa "tudo
  // permitido" por omissão. Única exceção: scope=REPOSITORY_WIDE + explicitPolicyAuthorization
  // explícita e persistida (nunca default/inferida).
  checks.push({
    id: 'PATH_BOUNDARY_FAIL_CLOSED_EMPTY_SCOPE',
    ...checkFileContains('engine/engineeringRouter/pathBoundary.js', [
      /NO_PATCH_SCOPE/, /repositoryWideAuthorized/, /explicitPolicyAuthorization/,
    ]),
  });
  checks.push({
    id: 'NO_PATCH_SCOPE_FAILURE_CODE_DEFINED',
    ...checkFileContains('engine/engineeringRouter/constants.js', [/NO_PATCH_SCOPE/]),
  });
  checks.push({
    id: 'EXPLICIT_POLICY_AUTHORIZATION_PERSISTED',
    ok: (() => {
      const modelSrc = readText('api/db/models/EngineeringTask.js');
      const contractSrc = readText('api/services/engineeringRouter/engineeringRouterService.js');
      return /explicit_policy_authorization/.test(modelSrc) && /explicitPolicyAuthorization/.test(contractSrc);
    })(),
    reason: 'explicit_policy_authorization precisa existir no model persistido E ser propagado ao Task Contract em runtime (contractFromTask)',
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
    // ER-V1-FINAL-001: testRunnerService.js delega a execução real ao Execution Sandbox
    // (executionSandbox.js) — o `spawn(..., {shell:false})` que efetivamente roda o processo
    // migrou para lá; testRunnerService.js continua responsável por parsear/validar o comando
    // pela allowlist estrutural antes de repassar ao sandbox.
    ...checkFileContains('api/services/engineeringRouter/testRunnerService.js', [/parseCommand/, /runInSandbox/]),
  });
  checks.push({
    id: 'SANDBOX_STRUCTURED_COMMAND_EXECUTION',
    ...checkFileContains('api/services/engineeringRouter/executionSandbox.js', [/shell:\s*false/]),
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
  // Achado real do PILOT REAL (provider de IA real, não fake): `engineeringAiInvoker.js`
  // herdava o `error.code` EXTERNO do provider (ex.: DeepSeek sem saldo retorna
  // `"invalid_request_error"`) como o `wrapped.code` do nosso domínio sempre que não era
  // undefined/null — nunca virava PROVIDER_UNAVAILABLE, então o reroute (ERV1-CLOSE-008) nunca
  // disparava para essa classe inteira de falha real. Corrigido: wrapped.code é SEMPRE
  // PROVIDER_UNAVAILABLE; código/status originais preservados em httpStatus/providerErrorCode.
  checks.push({
    id: 'INVOKER_ALWAYS_CLASSIFIES_AS_PROVIDER_UNAVAILABLE',
    ok: exists('api/services/engineeringRouter/engineeringAiInvoker.js')
      && /wrapped\.code = FAILURE_CODES\.PROVIDER_UNAVAILABLE/.test(readText('api/services/engineeringRouter/engineeringAiInvoker.js'))
      && /wrapped\.httpStatus/.test(readText('api/services/engineeringRouter/engineeringAiInvoker.js')),
    reason: 'engineeringAiInvoker.js precisa sempre marcar falhas reais de invocação como PROVIDER_UNAVAILABLE (nunca herdar o error.code externo do provider), preservando httpStatus/providerErrorCode para classificação (achado do pilot real)',
  });
  checks.push({
    id: 'MODEL_AVAILABILITY_RECOGNIZES_NO_CREDIT',
    ...checkFileContains('api/services/engineeringRouter/modelAvailabilityStore.js', [/NO_CREDIT/, /insufficient/i]),
  });

  // Achado real do usuário testando o pilot real: kimi:moonshot-v1-128k (mapeado estaticamente)
  // não estava mais habilitado para a credencial real, e isso só era descoberto REATIVAMENTE
  // (tenta rotear, gasta uma chamada real, falha). Discovery proativo consulta os modelIds
  // REAIS que a credencial pode usar (GET {baseUrl}/models, cache de 15min, fail-open) e filtra
  // a allowlist estática ANTES de rotear — só para credencial já confirmada `valid` (nunca
  // `unknown`, para não gastar chamada de rede real com chave possivelmente fake/não testada).
  checks.push({
    id: 'PROVIDER_MODEL_DISCOVERY_PROACTIVE',
    ...checkFileContains('api/services/engineeringRouter/engineeringModelAvailabilityService.js', [
      /providerModelDiscoveryCache/, /MODEL_NOT_LISTED_BY_PROVIDER/, /status !== 'valid'/,
    ]),
  });
  checks.push({
    id: 'PROVIDER_MODEL_DISCOVERY_FAIL_OPEN',
    ...checkFileContains('api/services/aiCredentialValidation.js', [/listAvailableModelIds/]),
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
    ...checkFileContains('api/services/engineeringRouter/regressionGovernanceService.js', [/checkRegression/, /runTestCommands/, /buildRegressionPlan/]),
  });
  // ER-V1-FINAL-006 — Real Regression: checkRegression precisa EXECUTAR comandos de verdade
  // (nunca só reler EngineeringTestRun da fase TESTING original) e persistir um
  // EngineeringRegressionRun amarrado ao sourceFingerprint da execução real.
  checks.push({
    id: 'REGRESSION_PLAN_PROPORTIONAL_TO_RISK',
    ...checkFileContains('engine/engineeringRouter/regressionPlan.js', [
      /buildRegressionPlan/, /findRelatedTestFiles/, /findSubsystemTestFiles/, /GOVERNANCE_GATE_COMMAND/,
    ]),
  });
  checks.push({
    id: 'REGRESSION_RUN_PERSISTED_WITH_FINGERPRINT',
    ok: (() => {
      const src = readText('api/services/engineeringRouter/regressionGovernanceService.js');
      return /createRegressionRun/.test(src) && /computeSourceFingerprint/.test(src);
    })(),
    reason: 'checkRegression precisa persistir EngineeringRegressionRun amarrado ao sourceFingerprint real da execução',
  });
  checks.push({
    id: 'ENGINEERING_REGRESSION_RUN_MODEL_EXISTS',
    ok: exists('api/db/models/EngineeringRegressionRun.js'),
    reason: 'api/db/models/EngineeringRegressionRun.js ausente',
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

  // ERV1-CLOSE-005: GREEN não pode significar "patch existiu num workspace temporário" — a
  // promoção do patch EXATO validado (commit real + branch local dedicada, nunca push/merge/
  // publish) precisa acontecer antes de declarar GREEN.
  checks.push({
    id: 'PROMOTION_SERVICE',
    ...checkFileContains('api/services/engineeringRouter/promotionService.js', [
      /promoteValidatedPatch/, /validatedPatchHash/, /validatedTreeHash/, /PROMOTION_TARGET_DIVERGED/, /postPromotionTestPass/,
    ]),
  });
  checks.push({
    id: 'PROMOTION_NEVER_PUSHES_OR_MERGES',
    ok: exists('api/services/engineeringRouter/promotionService.js')
      && !/['"]push['"]/.test(readText('api/services/engineeringRouter/promotionService.js'))
      && !/['"]merge['"]/.test(readText('api/services/engineeringRouter/promotionService.js')),
    reason: 'promotionService.js nunca pode conter git push/merge — só commit-tree + branch local (ERV1-CLOSE-005)',
  });
  checks.push({
    id: 'PROMOTION_WIRED_BEFORE_GREEN',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /promoteValidatedPatch/, /READY_FOR_PROMOTION/, /promotionResult\.promoted/,
    ]),
  });
  // ER-V1-FINAL-002 — Exact Promotion: `git add -A` no workspace da tentativa (onde testes já
  // rodaram) não prova candidate==baseline+patch — precisa comparar contra uma árvore
  // calculada independentemente (baseline limpo + patch, workspace descartável nunca tocado
  // por CODER/TESTE/REVIEW).
  checks.push({
    id: 'PROMOTION_EXPECTED_TREE_INDEPENDENT_COMPUTATION',
    ...checkFileContains('api/services/engineeringRouter/promotionService.js', [
      /computeExpectedTreeHash/, /expectedTreeHash/, /PROMOTION_TREE_CONTAMINATED/,
    ]),
  });
  checks.push({
    id: 'PROMOTION_EXACTNESS_ENFORCED_BEFORE_COMMIT',
    ok: (() => {
      const src = readText('api/services/engineeringRouter/promotionService.js');
      const contaminationCheckIdx = src.indexOf('PROMOTION_TREE_CONTAMINATED');
      const commitTreeIdx = src.indexOf("'commit-tree'");
      return contaminationCheckIdx !== -1 && commitTreeIdx !== -1 && contaminationCheckIdx < commitTreeIdx;
    })(),
    reason: 'a checagem de contaminação da árvore precisa acontecer ANTES do commit candidato ser criado (nunca depois)',
  });
  checks.push({
    id: 'PROMOTION_EVIDENCE_TREE_HASHES_PERSISTED',
    ...checkFileContains('api/services/engineeringRouter/promotionService.js', [
      /baselineTreeHash/, /expectedTreeHash/, /candidateTreeHash/, /promotedTreeHash/, /fileSetHash/, /promotionStatus/,
    ]),
  });
  // Achado real ao validar a tela de detalhe da task no browser: o motivo exato de uma
  // promoção que não completou (promotionResult.code) nunca era persistido junto com
  // promotion_evidence — só existia no evento WebSocket ao vivo. Quem abrisse a tela depois da
  // execução via READY_FOR_PROMOTION sem nenhum motivo.
  checks.push({
    id: 'PROMOTION_EVIDENCE_PERSISTS_FAILURE_CODE',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /\.\.\.promotionResult\.evidence,\s*code:\s*promotionResult\.code/,
    ]),
  });
  checks.push({
    id: 'UI_SHOWS_PROMOTION_EVIDENCE',
    ...checkFileContains('frontend/src/pages/EngineeringTaskDetailPage.jsx', [
      /promotion_evidence/, /candidateBranch/, /postPromotionTestPass/,
    ]),
  });

  // ERV1-CLOSE-007: Release Closure não pode usar um critério paralelo simplificado
  // (goNoGo.status==='GO' && finalReadiness.startsWith('PASS')) — precisa reutilizar a
  // autoridade real já existente (run corrente + Final Consistency Gate) e cruzar cada
  // artefato lido contra o mesmo runId/sourceFingerprint, nunca aceitar evidência de outro run.
  checks.push({
    id: 'RELEASE_CLOSURE_USES_REAL_RUN_AUTHORITY',
    ...checkFileContains('api/services/engineeringRouter/releaseClosureService.js', [
      /isSameRun/,
      /readRunContext/,
      /final-consistency-gate-report/,
      /lockReasons/,
    ]),
  });
  checks.push({
    id: 'RELEASE_CLOSURE_NEVER_ACCEPTS_FOREIGN_RUN_EVIDENCE',
    ok: exists('api/services/engineeringRouter/releaseClosureService.js')
      && /FOREIGN_RUN/.test(readText('api/services/engineeringRouter/releaseClosureService.js'))
      && /cleanReleaseState\s*=\s*lockReasons\.length === 0/.test(readText('api/services/engineeringRouter/releaseClosureService.js')),
    reason: 'releaseClosureService.js precisa declarar cleanReleaseState apenas quando lockReasons estiver vazio, e listar FOREIGN_RUN quando um artefato não for do run corrente (ERV1-CLOSE-007)',
  });
  checks.push({
    id: 'RELEASE_CLOSURE_TEST_COVERAGE',
    ok: exists('tests/integration/engineeringReleaseClosureAuthority.test.js'),
    reason: 'faltando tests/integration/engineeringReleaseClosureAuthority.test.js (ERV1-CLOSE-007)',
  });

  // ERV1-CLOSE-010: certificação de runtime precisa existir como coletor real (nunca só como
  // "código contém padrão X") e o modo `--runtime` precisa estar isolado do modo padrão usado
  // pelo gate ao vivo (checkGovernance) — ver comentário grande mais abaixo sobre o deadlock de
  // bootstrap que essa separação evita.
  checks.push({
    id: 'RUNTIME_CERTIFICATION_COLLECTOR_EXISTS',
    ...checkFileContains('scripts/governance/collect-engineering-router-runtime-evidence.js', [
      /RUNTIME_ITEMS/, /computeSourceFingerprint/, /engineering-router-v1-runtime-evidence/,
    ]),
  });
  checks.push({
    id: 'RUNTIME_MODE_SEPARATED_FROM_LIVE_GATE',
    ok: (() => {
      const src = readText('scripts/governance/validate-engineering-router-v1.js');
      return /process\.argv\.includes\('--runtime'\)/.test(src) && /RUNTIME_NOT_REQUESTED/.test(src);
    })(),
    reason: 'o modo padrão do gate (usado por checkGovernance no loop ao vivo) precisa continuar sem exigir evidência de runtime — só --runtime explícito ativa RUNTIME_PASS (ERV1-CLOSE-010)',
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
    'tests/unit/engineeringRouterPathBoundary.test.js',
    'tests/unit/engineeringRouterPatchValidator.test.js',
    'tests/unit/engineeringRouterTestOutputAuthority.test.js',
    'tests/unit/engineeringRouterModelAvailabilityStore.test.js',
    'tests/unit/engineeringRouterProviderModelDiscovery.test.js',
    'tests/integration/engineeringRouterPromotionEvidencePersistence.test.js',
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
    'tests/integration/engineeringPromotionService.test.js',
    'tests/integration/engineeringReleaseClosureAuthority.test.js',
    'tests/integration/engineeringRouterReviewerRejectionRecodeE2E.test.js',
    'tests/unit/engineeringRouterExecutionSandboxSecurity.test.js',
    'tests/unit/engineeringRouterFailClosedScope.test.js',
    'tests/integration/engineeringRouterMandatoryRuntimeGate.test.js',
    'tests/unit/engineeringRouterTolerantTransition.test.js',
    'tests/unit/engineeringRouterRegressionPlan.test.js',
  ];
  for (const f of testFiles) {
    checks.push({ id: `TEST_${path.basename(f)}`, ok: exists(f), reason: `${f} ausente` });
  }

  // 14.5. ER-V1-FINAL-001 — Execution Sandbox: testCommands executam dentro de um container
  // Docker descartável, non-root, sem rede, sem docker socket, filesystem raiz read-only e
  // limites de CPU/memória/PIDs — nunca mais um `spawn` de host puro.
  const sandboxSrc = readText('api/services/engineeringRouter/executionSandbox.js');
  checks.push({
    id: 'SANDBOX_NETWORK_NONE_BY_DEFAULT',
    ok: /network\s*=\s*'none'/.test(sandboxSrc) && /--network=\$\{network/.test(sandboxSrc),
    reason: 'sandbox precisa negar rede por padrão (--network none)',
  });
  checks.push({
    id: 'SANDBOX_READ_ONLY_ROOTFS',
    ok: /--read-only/.test(sandboxSrc),
    reason: 'sandbox precisa de filesystem raiz read-only',
  });
  checks.push({
    id: 'SANDBOX_CAP_DROP_ALL',
    ok: /--cap-drop=ALL/.test(sandboxSrc) && /--security-opt=no-new-privileges/.test(sandboxSrc),
    reason: 'sandbox precisa derrubar todas as capabilities e negar no-new-privileges',
  });
  checks.push({
    id: 'SANDBOX_NON_ROOT_FIXED_UID',
    ok: /const SANDBOX_UID_GID = process\.env\.ENGINEERING_ROUTER_SANDBOX_UIDGID \|\| '10001:10001'/.test(sandboxSrc),
    reason: 'sandbox precisa rodar sob UID fixo não-privilegiado (10001:10001 por default), nunca root',
  });
  checks.push({
    id: 'SANDBOX_RESOURCE_LIMITS',
    ok: /--pids-limit=/.test(sandboxSrc) && /--memory=/.test(sandboxSrc) && /--cpus=/.test(sandboxSrc),
    reason: 'sandbox precisa de limites explícitos de PIDs/memória/CPU',
  });
  checks.push({
    id: 'SANDBOX_NEVER_MOUNTS_DOCKER_SOCKET',
    ok: !/docker\.sock/.test(sandboxSrc),
    reason: 'sandbox nunca pode montar o socket do Docker do host (escaparia do isolamento)',
  });
  checks.push({
    id: 'SANDBOX_NODE_MODULES_READ_ONLY',
    ok: /node_modules[\s\S]*?:ro`/.test(sandboxSrc),
    reason: 'sandbox precisa montar node_modules do repositório como read-only (nunca gravável)',
  });
  checks.push({
    id: 'SANDBOX_FAIL_CLOSED_WHEN_UNAVAILABLE',
    ok: /SANDBOX_UNAVAILABLE/.test(sandboxSrc) && /throw error/.test(sandboxSrc),
    reason: 'sandbox indisponível precisa falhar explicitamente, nunca cair de volta para execução sem sandbox',
  });
  checks.push({
    id: 'TEST_RUNNER_USES_SANDBOX',
    ...checkFileContains('api/services/engineeringRouter/testRunnerService.js', [/runInSandbox/]),
  });
  checks.push({
    id: 'PATCH_APPLY_NO_WRITABLE_NODE_MODULES_SYMLINK',
    ok: !/symlinkSync\([\s\S]*?node_modules/.test(readText('api/services/engineeringRouter/patchApplyService.js')),
    reason: 'patchApplyService.js não pode mais criar o symlink gravável de node_modules para o node_modules real do repositório (ER-V1-FINAL-001)',
  });
  // ER-V1-FINAL-004 — Mandatory Runtime Gate: o pipeline oficial de selagem
  // (scripts/governance/seal-release.sh → npm run validate:governance-enforcement) precisa
  // exigir RUNTIME_PASS, nunca aceitar STRUCTURAL_PASS/RUNTIME_NOT_REQUESTED sozinho para
  // selar uma release que inclui o Engineering Router. O caminho ao vivo (checkGovernance, por
  // task) continua invocando o script direto sem --runtime — nunca deadlock de bootstrap.
  checks.push({
    id: 'MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE',
    ok: (() => {
      const pkg = JSON.parse(readText('package.json'));
      const script = pkg.scripts && pkg.scripts['validate:governance-enforcement'];
      return typeof script === 'string'
        && script.includes('npm run validate:engineering-router-v1:runtime')
        && !/validate:engineering-router-v1 &&/.test(script);
    })(),
    reason: 'validate:governance-enforcement precisa chamar validate:engineering-router-v1:runtime (nunca a versão structural-only) — é a autoridade que scripts/governance/seal-release.sh usa para selar releases',
  });
  // ER-V1-FINAL-005 — Durable Resume: transitionTask(...).catch(()=>{}) cego (engole QUALQUER
  // erro, não só a retomada idempotente esperada) nunca pode reaparecer no loop principal —
  // substituído por tolerantTransition, que só tolera quando o estado real já é o destino, e
  // propaga/fail-safe em qualquer outro caso.
  checks.push({
    id: 'NO_BLIND_TRANSITION_CATCH',
    ok: !/transitionTask\([^)]*\)\.catch\(\(\)\s*=>\s*\{/.test(readText('api/services/engineeringRouter/engineeringRouterService.js')),
    reason: 'engineeringRouterService.js não pode conter transitionTask(...).catch(() => {}) cego — usar tolerantTransition',
  });
  checks.push({
    id: 'TOLERANT_TRANSITION_FAIL_SAFE_ON_TERMINAL',
    ...checkFileContains('api/services/engineeringRouter/engineeringRouterService.js', [
      /function tolerantTransition/, /TASK_ALREADY_TERMINAL_DURING_RESUME/, /TERMINAL_STATES\.includes\(current\.status\)/,
    ]),
  });
  checks.push({
    id: 'LIVE_GOVERNANCE_CHECK_NEVER_REQUIRES_RUNTIME',
    ok: (() => {
      const src = readText('api/services/engineeringRouter/regressionGovernanceService.js');
      return /execFileAsync\(process\.execPath, \[scriptPath\]/.test(src) && !/--runtime/.test(src);
    })(),
    reason: 'checkGovernance() (loop ao vivo, por-task) nunca pode passar --runtime — reintroduziria o deadlock de bootstrap documentado em ERV1-CLOSE-010',
  });

  // ER-V1-FINAL-008 — Current Model Catalog: modelo real descoberto pelo provider mas ausente da
  // allowlist estática (`modelCapabilities.js`) nunca pode ser simplesmente descartado sem
  // rastro — precisa virar uma entrada governada DISCOVERED/UNCLASSIFIED (auditável), NUNCA
  // elegível automaticamente para roteamento, nem sequer para tasks de risco LOW/MEDIUM.
  checks.push({
    id: 'MODEL_CATALOG_POLICY_PURE_MODULE',
    ...checkFileContains('engine/engineeringRouter/modelCatalogPolicy.js', [
      /function resolveCatalogStatus/, /function isEligibleForRisk/, /ELIGIBLE_STATUSES = new Set\(\['APPROVED'\]\)/,
    ]),
  });
  checks.push({
    id: 'MODEL_CATALOG_STATUSES_VOCABULARY',
    ...checkFileContains('engine/engineeringRouter/constants.js', [
      /MODEL_CATALOG_STATUSES = Object\.freeze\(\[/, /'DISCOVERED'/, /'UNCLASSIFIED'/, /'CLASSIFIED'/, /'APPROVED'/, /'RETIRED'/, /'DENIED'/,
    ]),
  });
  checks.push({ id: 'ENGINEERING_MODEL_CATALOG_ENTRY_MODEL', ok: exists('api/db/models/EngineeringModelCatalogEntry.js'), reason: 'model EngineeringModelCatalogEntry ausente' });
  checks.push({
    id: 'ENGINEERING_MODEL_CATALOG_ENTRY_MIGRATION',
    ok: fs.readdirSync(path.join(ROOT, 'api/db/migrations')).some((f) => f.includes('create-engineering-model-catalog-entries')),
    reason: 'migration de engineering_model_catalog_entries ausente',
  });
  checks.push({
    id: 'MODEL_CATALOG_SERVICE_PERSISTS_REAL',
    ...checkFileContains('api/services/engineeringRouter/modelCatalogService.js', [
      /getEngineeringModelCatalogEntryModel/, /async function reconcileDiscoveredModel/, /resolveCatalogStatus/,
    ]),
  });
  // Discovery real já era usado só para EXCLUIR candidatos mapeados que sumiram — precisa
  // também reconciliar o catálogo governado nas duas direções (modelo novo → DISCOVERED; modelo
  // mapeado que sumiu → RETIRED), nunca só descartar silenciosamente o resultado do discovery.
  checks.push({
    id: 'MODEL_AVAILABILITY_RECONCILES_CATALOG',
    ...checkFileContains('api/services/engineeringRouter/engineeringModelAvailabilityService.js', [
      /reconcileProviderCatalog/, /modelCatalogService\.reconcileDiscoveredModel/,
    ]),
  });

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

  // ERV1-CLOSE-010: STRUCTURAL_PASS (tudo acima — o código CONTÉM os padrões esperados) é
  // necessário mas nunca suficiente. RUNTIME_PASS (abaixo) prova que o comportamento
  // efetivamente ACONTECE, com exitCode real e evidência amarrada à versão atual do código.
  //
  // RUNTIME_PASS só entra com a flag `--runtime` explícita — NUNCA no modo padrão. Achado real
  // ao ligar isto: este MESMO script (`validate-engineering-router-v1.js`) é invocado como
  // subprocess por `checkGovernance()` (regressionGovernanceService.js), que por sua vez é
  // chamado dentro do estágio GOVERNANCE de TODA EngineeringTask real, no caminho quente do
  // próprio loop de auto-melhoria. Exigir evidência de runtime sempre fresca (fingerprint exato)
  // ali criaria um deadlock de bootstrap: nenhuma task chegaria a GREEN sem evidência fresca, e
  // gerar evidência fresca exige rodar vários testes que passam pelo próprio estágio GOVERNANCE
  // (logo, por este gate) — nunca poderiam ficar frescos ao mesmo tempo. RUNTIME_PASS é portanto
  // uma certificação separada, para release closure/CI (`npm run
  // validate:engineering-router-v1:runtime`), nunca parte do gate por-task ao vivo.
  const structuralFailed = checks.filter((c) => !c.ok);
  const structuralStatus = structuralFailed.length === 0 ? 'STRUCTURAL_PASS' : 'STRUCTURAL_FAIL';

  const runtimeMode = process.argv.includes('--runtime');
  const runtimeChecks = runtimeMode ? buildRuntimeChecks() : [];
  const runtimeFailed = runtimeChecks.filter((c) => !c.ok);
  const runtimeStatus = !runtimeMode ? 'RUNTIME_NOT_REQUESTED' : (runtimeFailed.length === 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL');

  checks.push(...runtimeChecks);
  const failed = checks.filter((c) => !c.ok);

  const report = {
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    decision: failed.length === 0 ? 'ENGINEERING_ROUTER_V1_GO' : 'ENGINEERING_ROUTER_V1_GAPS',
    structuralStatus,
    runtimeStatus,
    artifactType: 'engineering-router-v1-report',
    artifactVersion: '1.0.0',
    totalChecks: checks.length,
    failedChecks: failed.length,
    structuralFailedChecks: structuralFailed.length,
    runtimeFailedChecks: runtimeFailed.length,
    checks,
  };

  writeReport('engineering-router-v1-report.json', report);

  console.log(`[engineering-router-v1] status=${report.status} (${structuralStatus}/${runtimeStatus}) checks=${checks.length} falhas=${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(` - ${f.id}: ${f.reason}`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main();

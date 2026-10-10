'use strict';

/**
 * scripts/governance/validate-mission-self-engineering-gates.js
 *
 * TRÊS GATES BLOQUEANTES DO SELF-ENGINEERING (missão 2026-10-03):
 *
 *   MISSION_SOURCE_INTEGRITY              — a fonte da missão não avança sem causa auditável (intent
 *                                           persistido antes do efeito no git) e NÃO adota branch
 *                                           que ela não consegue explicar.
 *   BUG_WORKER_RUNTIME_HEALTH             — a saúde do worker do Bug Loop é MEDIDA e consumida pelo
 *                                           readiness de engenharia: worker ausente/morto não
 *                                           pode passar por pronto.
 *   LEGITIMATE_GOVERNANCE_CHANGE_RUNTIME  — mudança legítima de governança (aval humano explícito,
 *                                           motivo e reviewer independente) atravessa o runtime; o
 *                                           resto continua bloqueado.
 *
 * DESENHO — DUAS CAMADAS, E AS DUAS SÃO OBRIGATÓRIAS:
 *
 *   1. CONTRATO no código: o mecanismo tem de EXISTIR na fonte. É determinístico e barato, mas
 *      sozinho NÃO prova nada — um `grep` encontra um símbolo exportado que ninguém chama.
 *   2. PROVA EXECUTÁVEL: as suítes de prova têm de estar DECLARADAS no manifesto autoritativo
 *      (`config/canonical-release-suites.json`) e constar como PASS na execução autoritativa
 *      (`reports/release-suite-execution.json`).
 *
 * FAIL-CLOSED DE PROPÓSITO: sem o relatório de execução, ou com a suíte NOT_EXECUTED, o veredito é
 * BLOCKED — nunca PASS. Um gate que não pode falhar não é um gate.
 *
 * `--axis <NOME>` restringe o CÓDIGO DE SAÍDA a um eixo, para que cada condição seja um passo
 * bloqueante INDEPENDENTE no selo. O relatório é sempre completo e tem um único produtor — não há
 * duas verdades sobre o mesmo eixo.
 */

const fs = require('fs');
const path = require('path');
const { ROOT, writeReport } = require('./common');
const { withLineage } = require('../../governance/report-lineage');

const REPORT_NAME = 'mission-self-engineering-gates-report.json';
const MANIFEST_REL = 'config/canonical-release-suites.json';
const EXECUTION_REL = 'reports/release-suite-execution.json';

const SERVICE = 'api/services/engineeringMission/missionSourceService.js';
const MISSION_SOURCE_ENGINE = 'engine/engineeringMission/missionSource.js';
const RECOVERY_COORDINATOR = 'api/services/engineeringMission/missionRecoveryCoordinator.js';
const BUG_LOOP_COORDINATOR = 'api/services/engineeringMission/bugLoopCoordinatorService.js';
const MISSION_ORCHESTRATOR = 'api/services/engineeringMission/missionOrchestratorService.js';
const BUG_FINDING = 'api/services/engineeringMission/bugFindingService.js';
const START_WORKERS = 'api/runtime/startWorkers.js';
const BUG_LOOP_WORKER = 'api/services/engineeringMission/bugLoopWorker.js';
const WORKER_HEALTH_ENGINE = 'engine/engineeringMission/workerHealth.js';
const MISSION_ROUTES = 'api/modules/engineering-missions/routes.js';
const SELF_MODIFICATION = 'engine/engineeringMission/bugFinding/selfModification.js';
const BUG_TRIAGE = 'api/services/engineeringMission/bugTriageService.js';

const AXES = [
  {
    id: 'MISSION_SOURCE_INTEGRITY',
    requirement: 'nenhum avanço da fonte sem IntegrationIntent durável; branch não explicada é recusada; fence avança em TODO caminho; branch apagada é recriada no commit autoritativo',
    contracts: [
      { name: 'gate_exige_intent', file: SERVICE, needle: 'INTEGRATION_INTENT_REQUIRED' },
      { name: 'intent_persistido_antes_do_git', file: SERVICE, needle: 'prepareIntegrationIntent' },
      { name: 'failpoint_da_janela_critica', file: SERVICE, needle: 'after_git_update_ref_before_db_cas' },
      { name: 'rejeicao_de_branch_nao_explicada', file: SERVICE, needle: 'classifyBranchAdoption' },
      { name: 'codigo_de_divergencia', file: MISSION_SOURCE_ENGINE, needle: 'MISSION_SOURCE_DIVERGENCE' },
      { name: 'seam_de_prova_exportado', file: SERVICE, needle: 'advanceMissionSource,' },
      { name: 'reconciliacao_de_intents', file: SERVICE, needle: 'reconcileMissionSourceIntents' },
      // ── FENCE: toda mudança de commit avança o fence, por UM único caminho (CAS) ──
      { name: 'cas_unico_commit_e_fence', file: SERVICE, needle: 'async function applySourceAdvanceCommit' },
      { name: 'fence_avanca_no_avanco', file: SERVICE, needle: 'mission_source_fence: Number(fence) + 1' },
      { name: 'posse_verificada_antes_do_git', file: SERVICE, needle: 'STALE_FENCE_REJECTED' },
      // ── INICIALIZAÇÃO crash-safe (intent antes do `git branch`) ──
      { name: 'tipo_de_intent_de_inicializacao', file: MISSION_SOURCE_ENGINE, needle: 'MISSION_SOURCE_INITIALIZATION' },
      { name: 'chave_unica_de_inicializacao', file: MISSION_SOURCE_ENGINE, needle: 'buildInitializationKey' },
      { name: 'intent_de_inicializacao_persistido', file: SERVICE, needle: 'prepareInitializationIntent' },
      { name: 'branch_inicial_sem_intent_recusada', file: SERVICE, needle: 'UNTRUSTED_MISSION_SOURCE_INITIALIZATION' },
      // ── BRANCH APAGADA: recriação no commit autoritativo (nunca na main) ──
      { name: 'decisao_de_recriacao_no_engine', file: MISSION_SOURCE_ENGINE, needle: 'classifyBranchDeletionRecovery' },
      { name: 'recuperacao_exige_proveniencia', file: SERVICE, needle: 'MISSION_SOURCE_RECOVERY_REQUIRED' },
      // ── RECONCILIAÇÃO PERIÓDICA (não só no boot) ──
      { name: 'reconciliacao_no_loop_periodico', file: RECOVERY_COORDINATOR, needle: 'reconcilePendingIntents' },
      // ── STALE CANDIDATE: replan AUTOMÁTICO e LIMITADO (classificação sem comportamento não basta) ──
      { name: 'politica_de_replan_no_engine', file: MISSION_SOURCE_ENGINE, needle: 'planSourceReplan' },
      { name: 'limite_de_replan_declarado', file: MISSION_SOURCE_ENGINE, needle: 'SOURCE_REPLAN_POLICY' },
      { name: 'esgotamento_e_conflito_declarados', file: MISSION_SOURCE_ENGINE, needle: 'MISSION_SOURCE_REPLAN_EXHAUSTED' },
      { name: 'replan_acionado_no_runtime', file: BUG_LOOP_COORDINATOR, needle: 'maybeReplanAfterSourceFailure' },
      { name: 'replan_nao_recursiona', file: BUG_LOOP_COORDINATOR, needle: 'allowSourceReplan: false' },
      { name: 'hook_de_execucao_aciona_replan', file: MISSION_ORCHESTRATOR, needle: 'maybeReplanAfterSourceFailure' },
    ],
    suites: [
      'tests/integration/missionSourceCrashWindowE2E.test.js',
      'tests/integration/missionSourceLifecycleE2E.test.js',
      'tests/unit/engineeringMission/missionSource.test.js',
      'tests/unit/engineeringMission/sourceStaleAutomaticReplan.test.js',
    ],
  },
  {
    id: 'BUG_WORKER_RUNTIME_HEALTH',
    requirement: 'a saúde do worker do Bug Loop é medida e consumida pelo readiness de engenharia',
    contracts: [
      { name: 'readiness_puro_no_engine', file: WORKER_HEALTH_ENGINE, needle: 'assessEngineeringReadiness' },
      { name: 'readiness_consumido_no_runtime', file: START_WORKERS, needle: 'assessEngineeringReadiness(' },
      { name: 'worker_obrigatorio_declarado', file: START_WORKERS, needle: 'requiredWorkers' },
      { name: 'saude_exposta', file: START_WORKERS, needle: 'function getEngineeringWorkerHealth' },
      { name: 'endpoint_de_saude', file: MISSION_ROUTES, needle: '/engineering/missions/workers/health' },
      // A identidade é PRODUZIDA no worker e repassada INTEIRA para o endpoint: sem o segundo
      // contrato, a identidade existiria e nunca chegaria a quem observa.
      { name: 'identidade_do_worker_produzida', file: BUG_LOOP_WORKER, needle: 'workerInstanceId: runningWorkerInstanceId' },
      { name: 'identidade_chega_ao_endpoint', file: START_WORKERS, needle: 'workers: { bugLoop: worker }' },
    ],
    suites: ['tests/unit/engineeringMission/workerHealthRuntimeEnforcement.test.js', 'tests/unit/engineeringMission/workerHealth.test.js', 'tests/integration/bugWorkerFullBootE2E.test.js'],
  },
  {
    id: 'LEGITIMATE_GOVERNANCE_CHANGE_RUNTIME',
    requirement: 'mudança legítima de governança passa no runtime (HTTP REAL incluído); sem aval explícito continua bloqueada; o ciclo NÃO declara FIXED antes do aval e RETOMA sozinho depois dele',
    contracts: [
      { name: 'motor_decide_autorizacao', file: SELF_MODIFICATION, needle: 'assessGovernanceChangeAuthorization' },
      { name: 'concessao_explicita_montada', file: BUG_TRIAGE, needle: 'allowed: true, code: authorization.code' },
      { name: 'consentimento_persistido', file: BUG_TRIAGE, needle: 'governanceChangeApproved' },
      { name: 'baseline_aceita_autorizacao', file: SELF_MODIFICATION, needle: 'humanAuthorization' },
      // ── CONTRATO HTTP: o boundary NÃO pode descartar o consentimento de governança ──
      { name: 'http_encaminha_consentimento', file: MISSION_ROUTES, needle: 'governanceChangeApproved: body.governanceChangeApproved === true' },
      { name: 'http_encaminha_motivo', file: MISSION_ROUTES, needle: 'governanceChangeReason: body.governanceChangeReason || null' },
      { name: 'http_encaminha_reviewer', file: MISSION_ROUTES, needle: 'reviewer: body.reviewer || null' },
      { name: 'identidade_vem_da_auth', file: MISSION_ROUTES, needle: 'resolveAuthenticatedActorType' },
      // ── LIFECYCLE: FIXED só DEPOIS do aval; bloqueado permanece FIXING e retomável ──
      { name: 'fix_nao_declarado_antes_do_aval', file: BUG_LOOP_COORDINATOR, needle: 'markPendingGovernanceApproval' },
      { name: 'estado_de_bloqueio_nomeado', file: BUG_LOOP_COORDINATOR, needle: 'AWAITING_GOVERNANCE_APPROVAL' },
      { name: 'agenda_persistida_no_finding', file: BUG_FINDING, needle: 'markPendingGovernanceApproval' },
      { name: 'avaliacao_de_politica_no_ato', file: BUG_TRIAGE, needle: 'policyRequiresIndependentReviewer' },
      // ── RETOMADA AUTOMÁTICA: o finding bloqueado CONTINUA sendo varrido ──
      { name: 'finding_bloqueado_permanece_selecionavel', file: BUG_LOOP_COORDINATOR, needle: "status: ['CONFIRMED', 'FIXING']" },
    ],
    suites: [
      'tests/unit/engineeringMission/governanceChangeRuntimeAuthorization.test.js',
      'tests/unit/engineeringMission/governanceBaseline.test.js',
      'tests/unit/engineeringMission/governanceApprovalLifecycle.test.js',
      'tests/unit/engineeringMissionRoutes.test.js',
    ],
  },
];

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (err) {
    return null;
  }
}

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (err) {
    return null;
  }
}

/** O mecanismo EXISTE na fonte? */
function evaluateContract({ name, file, needle }) {
  const text = readText(file);
  if (text === null) return { name, ok: false, detail: `arquivo ausente: ${file}` };
  const ok = text.includes(needle);
  return { name, ok, detail: ok ? `presente em ${file}` : `NÃO encontrado em ${file}: ${needle}` };
}

/** Estado da suíte na execução AUTORITATIVA. Ausente/execução ausente ⇒ BLOCKED (nunca PASS). */
function evaluateSuite(suite, execution, declaredInManifest) {
  if (!declaredInManifest) {
    return {
      suite,
      declaredInManifest: false,
      state: 'NOT_DECLARED',
      testsExecuted: null,
      reason: 'não está declarada em config/canonical-release-suites.json — não roda na execução autoritativa',
    };
  }
  if (!execution) {
    return {
      suite,
      declaredInManifest: true,
      state: 'BLOCKED',
      testsExecuted: null,
      reason: `${EXECUTION_REL} ausente — sem execução autoritativa não há prova (fail-closed)`,
    };
  }
  const rows = Array.isArray(execution.results) ? execution.results : [];
  const found = rows.find((row) => row && row.suite === suite);
  if (!found) {
    return {
      suite,
      declaredInManifest: true,
      state: 'BLOCKED',
      testsExecuted: null,
      reason: `não consta da execução autoritativa (${execution.status || 'sem status'})`,
    };
  }
  return {
    suite,
    declaredInManifest: true,
    state: found.state || 'UNKNOWN',
    testsExecuted: typeof found.testsExecuted === 'number' ? found.testsExecuted : null,
    reason: found.reason || null,
  };
}

function evaluateAxis(axis, execution, explicit) {
  const contracts = axis.contracts.map(evaluateContract);
  const suites = axis.suites.map((suite) => evaluateSuite(suite, execution, explicit.includes(suite)));

  const failedContracts = contracts.filter((c) => !c.ok);
  const undeclared = suites.filter((s) => s.state === 'NOT_DECLARED');
  const notPass = suites.filter((s) => s.state !== 'PASS');
  // BLOCKED só quando a AUSÊNCIA de prova é a causa (execução ausente / suíte não executada).
  const blocked = notPass.filter((s) => ['BLOCKED', 'NOT_EXECUTED'].includes(s.state));

  let status = 'PASS';
  let reason = 'mecanismo presente na fonte e provas PASS na execução autoritativa';

  if (failedContracts.length > 0) {
    status = 'FAIL';
    reason = `mecanismo AUSENTE na fonte: ${failedContracts.map((c) => c.name).join(', ')}`;
  } else if (undeclared.length > 0) {
    status = 'FAIL';
    reason = `prova não declarada no manifesto autoritativo: ${undeclared.map((s) => s.suite).join(', ')}`;
  } else if (blocked.length > 0) {
    status = 'BLOCKED';
    reason = blocked.map((s) => `${s.suite}: ${s.reason}`).join('; ');
  } else if (notPass.length > 0) {
    status = 'FAIL';
    reason = notPass.map((s) => `${s.suite}: ${s.state}${s.reason ? ` (${s.reason})` : ''}`).join('; ');
  }

  return {
    axis: axis.id,
    requirement: axis.requirement,
    status,
    reason,
    contracts,
    suites,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const axisIndex = argv.indexOf('--axis');
  const requestedAxis = axisIndex >= 0 ? String(argv[axisIndex + 1] || '').trim() : null;

  if (requestedAxis !== null && !AXES.some((a) => a.id === requestedAxis)) {
    // Fail-closed: um eixo desconhecido NÃO pode virar PASS por engano.
    process.stderr.write(`--axis desconhecido: "${requestedAxis}". Válidos: ${AXES.map((a) => a.id).join(', ')}\n`);
    process.exit(2);
  }

  const manifest = readJson(MANIFEST_REL);
  const execution = readJson(EXECUTION_REL);
  const explicit = (manifest && manifest.discovery && Array.isArray(manifest.discovery.explicit))
    ? manifest.discovery.explicit
    : [];

  const axes = AXES.map((axis) => evaluateAxis(axis, execution, explicit));
  const required = requestedAxis ? axes.filter((a) => a.axis === requestedAxis) : axes;
  const overall = required.every((a) => a.status === 'PASS') ? 'PASS' : 'FAIL';

  // RELATÓRIO POR EIXO: cada passo do selo declara um artefato PRÓPRIO. Três passos escrevendo o
  // mesmo caminho criariam ambiguidade sobre quem produziu o quê, e um produto por eixo mantém
  // uma única verdade para cada condição.
  const slug = String(requestedAxis || 'ALL').toLowerCase().replace(/_/g, '-');
  const reportName = requestedAxis ? `mission-gate-${slug}.json` : REPORT_NAME;

  const output = writeReport(reportName, withLineage({
    artifactType: 'MISSION_SELF_ENGINEERING_GATES',
    requestedAxis,
    status: overall,
    statuses: Object.fromEntries(axes.map((a) => [a.axis, a.status])),
    executionReport: execution
      ? { present: true, status: execution.status || null, generatedAt: execution.generatedAt || null, runId: execution.runId || null }
      : { present: false, status: null, generatedAt: null, runId: null },
    manifestDeclared: explicit.length,
    axes,
  }, 'mission-self-engineering-gates-report'));

  for (const axis of axes) {
    process.stdout.write(`[${axis.status}] ${axis.axis} — ${axis.reason}\n`);
  }
  process.stdout.write(`relatório: ${path.relative(ROOT, output)}\n`);

  process.exit(overall === 'PASS' ? 0 : 1);
}

if (require.main === module) main();

module.exports = { AXES, evaluateAxis, evaluateContract, evaluateSuite };

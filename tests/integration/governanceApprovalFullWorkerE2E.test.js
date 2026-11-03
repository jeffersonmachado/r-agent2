'use strict';

/**
 * tests/integration/governanceApprovalFullWorkerE2E.test.js
 *
 * GOVERNANCE_APPROVAL_FULL_WORKER_E2E — a aprovação de mudança nas REGRAS QUE JULGAM o sistema,
 * atravessando o worker AUTÔNOMO de ponta a ponta, com evidência nos dois sentidos.
 *
 * O QUE FALTAVA. Existiam duas metades provadas em separado e NENHUMA costura entre elas:
 *   - `governanceChangeApprovalHttpE2E` prova a FRONTEIRA HTTP (auth, RBAC por ação, consentimento
 *     explícito, motivo, reviewer independente) — e declara no próprio cabeçalho que o resto tem
 *     prova própria;
 *   - `engineeringBugLoopNaturalPathE2E` prova que o worker conduz um finding até o fechamento —
 *     mas com finding COMUM, sem self-modification.
 * Nenhuma delas prova o que a política realmente exige: um finding que toca as próprias regras de
 * julgamento NÃO executa nada sem aval humano, e o MESMO worker, sozinho, conclui o ciclo depois
 * do aval.
 *
 * CADEIA PROVADA AQUI (tudo pelo caminho canônico, sem atalho):
 *   1. missão real compilada/aprovada/iniciada; a task da missão declara ESCOPO DE GOVERNANÇA
 *      (`scripts/governance/`) — é o que faz a triagem classificar o finding como self-modification;
 *   2. a task falha de forma NATURAL (fixture RED) → `hookMissionFailure` cria o finding;
 *   3. o WORKER REAL (`startBugLoopWorker`, a mesma função do runtime) triagem → classifica
 *      self-modification → `canRunFixAutonomously` RECUSA → **nenhuma tentativa de correção é
 *      executada** e o finding NÃO fecha (controle negativo observado, não declarado);
 *   4. um HUMANO registra o aval de governança pelo serviço canônico
 *      (`bugTriageService.approveSelfModification`, com consentimento explícito, motivo e reviewer
 *      independente);
 *   5. **o MESMO worker, sem nenhuma chamada do teste**, re-seleciona o finding, executa a correção
 *      pelo Router real, roda a verificação de baseline de governança, declara FIXED, executa a
 *      regressão e FECHA o finding;
 *   6. o coder NÃO é reexecutado (a task de correção tem exatamente 1 tentativa).
 *
 * O QUE É REAL: Postgres, Router completo, Engineering Runner + sandbox, git, gate de governança,
 * triagem/self-modification, worker autônomo, regressão.
 * O QUE É DUBLÊ: SOMENTE a chamada de rede ao LLM (providers determinísticos sob ids reais).
 *
 * Infra ausente ⇒ pulo EXPLÍCITO via `skipOrFail` (RELEASE_AUTHORITATIVE=1 lança).
 */

const path = require('path');
const { execFileSync } = require('child_process');

/**
 * ESCOPO DE CREDENCIAL DO ROUTER = O TENANT DESTA SUÍTE.
 *
 * O Router resolve credencial por `ENGINEERING_ROUTER_TENANT_ID` (default `system`) e, no runner
 * efêmero, `system` não tem credencial nenhuma: o diagnóstico do próprio teste mostrou
 * `routing_decision.coder = {selected: null, reasonCodes: [NO_QUALIFIED_CANDIDATE]}` e a task de
 * correção `BLOCKED` — nada a ver com o finding. O mesmo defeito já foi medido e corrigido em
 * `engineeringBugLoopNaturalPathE2E` (runs 39673283430 e 39676752021); aqui vale o MESMO padrão.
 *
 * ORDEM IMPORTA: a variável é lida no carregamento do módulo, então a atribuição vem ANTES dos
 * `require` que trazem `engineeringRouterService`/`engineeringModelAvailabilityService`.
 */
const TEST_TENANT_KEY = 'jest-e2e-gov-approval-worker';
process.env.ENGINEERING_ROUTER_TENANT_ID = TEST_TENANT_KEY;

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const bugTriageService = require('../../api/services/engineeringMission/bugTriageService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const bugLoopWorker = require('../../api/services/engineeringMission/bugLoopWorker');
// Drenagem do worker antes de fechar o banco: `stopBugLoopWorker()` só faz clearInterval e o ciclo
// em curso chamava o Sequelize já fechado ("getConnection after close"), derrubando o LOTE com
// 0 testes falhados e exit != 0. Ver tests/helpers/drainEngineeringWorker.js.
const { stopWorkerAndDrain } = require('../helpers/drainEngineeringWorker');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_DIR = 'tests/fixtures/engineering-router-sandbox/';
const FIXTURE_TEST_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';

/** Escopo DECLARADO da task: inclui governança ⇒ a triagem classifica self-modification. */
const GOVERNANCE_SCOPE = 'scripts/governance/';

const SUITE_NAME = 'governance-approval-full-worker-e2e';

/** Marcador do objetivo da task ORIGINAL — o dublê de LLM falha apenas nela. */
const ORIGINAL_STEP_MARKER = 'ORIGINAL-MISSION-STEP';

const FIX_DIFF = `diff --git a/${FIXTURE_FILE} b/${FIXTURE_FILE}
--- a/${FIXTURE_FILE}
+++ b/${FIXTURE_FILE}
@@ -1,7 +1,11 @@
 'use strict';

 function multiply(a, b) {
   return a * b;
 }

-module.exports = { multiply };
+function add(a, b) {
+  return a + b;
+}
+
+module.exports = { multiply, add };
`;

let dbAvailable = false;
let dbReason = null;
let sandboxAvailable = false;

const created = { findings: [], tasks: [], missions: [] };

function skipIfInfraMissing(available, reason, requirement) {
  if (available) return false;
  return skipOrFail({ suite: SUITE_NAME, available: false, reason, requirement });
}

function deleteCandidateBranchIfExists(taskId) {
  try {
    execFileSync('git', ['branch', '-D', `engineering-router/candidates/${taskId}`], { cwd: ROOT, stdio: 'ignore' });
  } catch (_) { /* branch pode não existir */ }
}

async function cleanupTask(taskId) {
  const index = require('../../api/db/models');
  const attempts = await engineeringTaskService.listAttempts(taskId).catch(() => []);
  for (const attempt of attempts) {
    await index.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
    await index.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
    await index.getEngineeringRegressionRun().destroy({ where: { attempt_id: attempt.id } }).catch(() => {});
  }
  await index.getEngineeringRegressionRun().destroy({ where: { task_id: taskId } }).catch(() => {});
  await index.getEngineeringAttempt().destroy({ where: { task_id: taskId } }).catch(() => {});
  await index.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } }).catch(() => {});
  await index.getEngineeringOperation().destroy({ where: { task_id: taskId } }).catch(() => {});
  await index.getEngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
}

/**
 * Guarda de ORDEM DO ESCOPO (a variável é lida no carregamento dos módulos do Router).
 *
 * Chamada no setup: se alguém mover a atribuição de `ENGINEERING_ROUTER_TENANT_ID` para depois dos
 * `require` — ou sobrescrevê-la no meio do arquivo — o Router volta a resolver credencial no tenant
 * `system`, e a suíte passa a depender de estado do operador (foi exatamente o defeito medido nos
 * runs 39673283430/39676752021). Aqui isso falha ALTO, no setup, em vez de virar `BLOCKED` no meio
 * do ciclo.
 */
function provisionCredentialScope() {
  const escopo = process.env.ENGINEERING_ROUTER_TENANT_ID;
  if (escopo !== TEST_TENANT_KEY) {
    throw new Error(
      `escopo de credencial do Router deveria ser ${TEST_TENANT_KEY} (tenant da suíte) e é ${escopo} — `
      + 'a env é lida no carregamento do módulo, então a atribuição tem de vir ANTES dos requires',
    );
  }
  return escopo;
}

/**
 * Não há nada a restaurar: o escopo é o tenant que esta suíte cria e destrói, e nenhuma credencial é
 * escrita em tenant de terceiro (o padrão canônico substituiu a fixture que usava `system`).
 * A função permanece como registro executável dessa garantia — se o escopo divergir no teardown,
 * algo escreveu no lugar errado e a suíte falha.
 */
function restoreCredentialScope() {
  const escopo = process.env.ENGINEERING_ROUTER_TENANT_ID;
  if (escopo !== TEST_TENANT_KEY) {
    throw new Error(`escopo de credencial divergiu no teardown: ${escopo} (esperado ${TEST_TENANT_KEY})`);
  }
  return { restored: false, reason: 'escopo é o tenant da suíte; nenhuma credencial de terceiro foi tocada' };
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }

  // Resíduo de execução interrompida: o sweep é GLOBAL por natureza — findings deixados por
  // execuções anteriores competem com o finding desta suíte e o ciclo não fecha no orçamento.
  const { purgeTestFindings } = require('../helpers/purgeTestFindings');
  await purgeTestFindings();

  // ESTADO TRANSITÓRIO COMPARTILHADO: uma falha real de modelo/provider numa execução ANTERIOR da
  // máquina pode deixar `UNAVAILABLE`/`RATE_LIMITED` (TTL de até 1 h) no store em memória do
  // processo, e aí `buildAvailableModels` não acha CODER qualificado — a task de correção morre em
  // `NO_QUALIFIED_CODER` sem NUNCA entrar no Router, e o finding não fecha. Medido em 2026-10-07:
  // a MESMA suíte fechou em ~70 s numa execução e travou 300 s na seguinte, sem log de Router para
  // a task de correção. Zerar esse estado transitório no setup não afrouxa asserção nenhuma: o
  // cenário continua exigindo o ciclo completo (patch real, sandbox, review, regressão, fechamento).
  require('../../api/services/engineeringRouter/modelAvailabilityStore')._clearAllForTests();
  require('../../api/services/engineeringRouter/providerModelDiscoveryCache')._clearAllForTests();

  const { isSandboxAvailable } = require('../../api/services/engineeringRouter/executionSandbox');
  sandboxAvailable = isSandboxAvailable();

  const index = require('../../api/db/models');
  await index.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Gov Approval Worker', status: 'active', plan: 'enterprise' },
  });

  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        const promptText = String(prompt || '');
        if (context && context.purpose === 'engineering_coder') {
          if (promptText.includes(ORIGINAL_STEP_MARKER)) {
            // A task ORIGINAL não é resolvida nesta etapa — a falha é natural e é dela que o
            // finding nasce.
            return { text: JSON.stringify({ summary: 'não foi possível corrigir nesta etapa', diff: '' }), usage: { prompt_tokens: 90, completion_tokens: 10 } };
          }
          return { text: JSON.stringify({ summary: 'adiciona add() em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
        }
        if (context && context.purpose === 'engineering_reviewer') {
          return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
        }
        throw new Error(`[${label}] purpose inesperado: ${context.purpose}`);
      },
    };
  }

  const CANDIDATE_PROVIDERS = ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq'];
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  provisionCredentialScope();
  for (const provider of CANDIDATE_PROVIDERS) {
    registerAiProvider(provider, makeFakeProvider(provider));
    await saveAICredentials(TEST_TENANT_KEY, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
  }
}, 60000);

afterAll(async () => {
  restoreCredentialScope();
  if (!dbAvailable) return;
  clearAiProviderConfig();
  const index = require('../../api/db/models');
  await stopWorkerAndDrain();
  try {
    for (const taskId of created.tasks) {
      deleteCandidateBranchIfExists(taskId);
      await cleanupTask(taskId);
    }
    if (created.findings.length) {
      await index.getEngineeringBugFindingEvent().destroy({ where: { finding_id: created.findings } }).catch(() => {});
      await index.getEngineeringBugFinding().destroy({ where: { id: created.findings } }).catch(() => {});
    }
    if (created.missions.length) {
      await index.EngineeringMissionApproval().destroy({ where: { mission_id: created.missions } }).catch(() => {});
      await index.EngineeringMission().destroy({ where: { id: created.missions } }).catch(() => {});
    }
    const tenant = await index.getTenant().findOne({ where: { tenant_key: TEST_TENANT_KEY } });
    if (tenant) {
      await index.getTenantAICredential().destroy({ where: { tenant_id: tenant.id } }).catch(() => {});
      await index.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } }).catch(() => {});
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('GOVERNANCE_APPROVAL — o worker autônomo bloqueia sem aval e conclui o ciclo com ele', () => {
  // O timeout da SUÍTE tem de ser MAIOR que a soma dos orçamentos internos
  // (triage + close). Com `setTimeout(900000)` e um `closeDeadline` de 900000 o Jest
  // disparava primeiro e o teste morria por timeout em vez de chegar ao diagnóstico
  // do ciclo — o orçamento interno precisa caber dentro do externo.
  jest.setTimeout(1800000);

  test('self-modification: nada executa sem aval humano; após o aval o worker fecha o finding sozinho', async () => {
    if (skipIfInfraMissing(dbAvailable, `postgres_unreachable (${dbReason})`, 'postgres')) return;
    if (skipIfInfraMissing(sandboxAvailable, 'sandbox Docker indisponível — reprodução real impossível (não é prova)', 'docker')) return;

    const index = require('../../api/db/models');
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

    // ── 1. MISSÃO REAL: compilada, aprovada e iniciada pelo caminho de produção ────────────────
    const compiled = await compiler.compileMission(
      `Repare a função de soma ausente em ${FIXTURE_FILE} sem quebrar a suíte existente.`,
      { createdBy: 'jest-gov-approval' },
    );
    const mission = compiled.mission;
    created.missions.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-gov-approval' });

    const started = await orchestrator.startExecution(mission.id, { actor: 'jest-gov-approval', tenantId: 'system' });
    const originalTaskId = started.task.id;
    created.tasks.push(originalTaskId);

    // A task da missão passa a exercitar a fixture RED controlada E DECLARA ESCOPO DE GOVERNANÇA.
    // O escopo é dado REAL lido pela triagem (`affected_files` derivado de `allowed_paths`): é ele
    // que classifica o finding como self-modification — não há campo forjado no teste.
    await index.getEngineeringTask().update(
      {
        test_commands: [FIXTURE_TEST_COMMAND],
        allowed_paths: [FIXTURE_DIR, GOVERNANCE_SCOPE],
        objective: `${ORIGINAL_STEP_MARKER} corrigir a soma ausente na fixture controlada`,
      },
      { where: { id: originalTaskId } },
    );

    // ── 2. FALHA NATURAL: a task roda e NÃO termina GREEN ──────────────────────────────────────
    const runResult = await orchestrator.runMissionTask(mission.id, { tenantId: 'system' });
    expect(runResult.result.status).not.toBe('GREEN');

    const findings = await bugFindingService.listFindings({ missionId: mission.id, limit: 10 });
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];
    created.findings.push(finding.id);

    // ── 3. WORKER REAL: sem aval humano NADA executa ───────────────────────────────────────────
    bugLoopWorker.startBugLoopWorker({ intervalMs: 1000, limit: 5, runImmediately: true });

    // Orçamento para o worker TRIAR o finding (e ser recusado pelo guard de self-modification).
    const triageDeadline = Date.now() + Number(process.env.GOV_APPROVAL_TRIAGE_WAIT_MS || 240000);
    let triaged = null;
    while (Date.now() < triageDeadline) {
      await sleep(1000);
      const current = await bugFindingService.getFinding(finding.id);
      if (current && current.self_modification && current.status === 'FIXING' && current.fix_task_id) { triaged = current; break; }
    }
    expect(triaged).toBeTruthy();

    // A CLASSIFICAÇÃO veio do caminho real (triagem), não de um campo forjado pelo teste.
    expect(triaged.self_modification).toBe(true);
    expect(triaged.triage.selfModification.selfModification).toBe(true);
    expect(triaged.triage.selfModification.humanApprovalRequired).toBe(true);
    expect(triaged.fix_task_id).toBeTruthy();
    created.tasks.push(triaged.fix_task_id);

    // O GUARD RECUSOU A EXECUÇÃO: a task de correção existe (triagem) mas NENHUMA tentativa rodou,
    // e o finding continua aberto. Observado por várias janelas do worker — não é declaração.
    const guardObservedUntil = Date.now() + Number(process.env.GOV_APPROVAL_HOLD_MS || 15000);
    let attemptsWhileBlocked = 0;
    while (Date.now() < guardObservedUntil) {
      await sleep(2000);
      attemptsWhileBlocked = Math.max(attemptsWhileBlocked, (await engineeringTaskService.listAttempts(triaged.fix_task_id).catch(() => [])).length);
    }
    expect(attemptsWhileBlocked).toBe(0);
    const stillOpen = await bugFindingService.getFinding(finding.id);
    expect(stillOpen.status).not.toBe('CLOSED');
    expect(stillOpen.human_approval_required).toBe(true);

    // ── 4. AVAL HUMANO pelo serviço canônico ──────────────────────────────────────────────────
    const approval = await bugTriageService.approveSelfModification(finding.id, {
      actor: 'operador-humano-qa',
      authenticatedActorType: 'HUMAN',
      hasSelfModificationPermission: true,
      governanceChangeApproved: true,
      governanceChangeReason: 'o critério de julgamento do subsistema mudou; o limiar antigo media outro conjunto',
      reviewer: 'auditor-independente-qa',
      requiresIndependentReviewer: true,
      note: 'aval de fixture do E2E de governança ponta a ponta',
    });
    expect(approval.approved).toBe(true);
    expect(approval.finding.human_approval_required).toBe(false);

    // ── 5. O MESMO WORKER, SOZINHO, CONCLUI O CICLO ───────────────────────────────────────────
    // Nada é chamado pelo teste daqui para frente: `runFixLoop`, `runBugLoopSweep` e
    // `handleAnomaly` NÃO aparecem neste arquivo. O teste só lê o banco.
    //
    // ORÇAMENTO × CARGA (medido 2026-10-11): isolada esta suíte fecha o ciclo em 68 s, mas no LOTE
    // autoritativo (`run-release-suites.js`, 6 suítes com `--runInBand` compartilhando o Engineering
    // Runner) ela estourou o antigo teto de 200 s e devolveu `closed=null` — flake de CARGA, não
    // defeito de código (reproduzida isolada: PASS). Mesmo remédio já aplicado à suíte irmã
    // (`ENGINEERING_E2E_WORKER_WAIT_MS`, 900 s): o orçamento cresce, a ASSERÇÃO não muda —
    // `expect(closed).toBeTruthy()` continua exigindo que o worker feche o finding sozinho.
    const closeDeadline = Date.now() + Number(process.env.GOV_APPROVAL_CLOSE_WAIT_MS || 900000);
    let closed = null;
    while (Date.now() < closeDeadline && !closed) {
      await sleep(1000);
      const current = await bugFindingService.getFinding(finding.id);
      if (current && current.status === 'CLOSED') closed = current;
    }
    if (!closed) {
      // DIAGNÓSTICO (não narrativa): quando o ciclo não fecha, o defeito é medido aqui — estado do
      // finding, contrato da task de correção e erro real das tentativas.
      const diagnostic = await bugFindingService.getFinding(finding.id);
      // O finding ESPERADO pode não ser o único da missão: o laço pode criar/renomear linhas por
      // dedupe e recorrência. Sem a lista completa, "status CONFIRMED" não distingue "não fechou"
      // de "fechou OUTRO finding" — foi exatamente a ambiguidade que travou o diagnóstico no
      // runner em 2026-10-29 (dois findings fecharam e o esperado continuou CONFIRMED).
      const diagFindings = await bugFindingService
        .listFindings({ missionId: mission.id, limit: 20 })
        .catch(() => []);
      const diagTask = await engineeringTaskService.getTask(triaged.fix_task_id);
      const diagAttempts = await engineeringTaskService.listAttempts(triaged.fix_task_id);
      console.log('DIAG_NAO_FECHOU', JSON.stringify({
        findingIdEsperado: finding.id,
        findingsDaMissao: diagFindings.map((f) => ({
          id: f.id, status: f.status, fix_task_id: f.fix_task_id, created_at: f.created_at,
          recurrence_count: f.recurrence_count, dedupe_key: f.dedupe_key,
        })),
        finding: {
          status: diagnostic.status, severity: diagnostic.severity, category: diagnostic.category,
          self_modification: diagnostic.self_modification,
          human_approval_required: diagnostic.human_approval_required,
          auto_approval_forbidden: diagnostic.auto_approval_forbidden,
          triageSelfModification: diagnostic.triage && diagnostic.triage.selfModification,
          pendingGovernanceApproval: diagnostic.triage && diagnostic.triage.pendingGovernanceApproval,
          ruleBaselineVerification: diagnostic.triage && diagnostic.triage.ruleBaselineVerification,
        },
        fixTask: {
          status: diagTask && diagTask.status,
          allowed_paths: diagTask && diagTask.allowed_paths,
          required_capabilities: diagTask && diagTask.required_capabilities,
          routing_decision: diagTask && diagTask.routing_decision,
          last_error: diagTask && diagTask.last_error,
          classifier_result: diagTask && diagTask.classifier_result,
        },
        attempts: diagAttempts.map((a) => ({ n: a.attempt_number, status: a.status, error: a.error })),
      }, null, 1));
    }
    const workerStatus = bugLoopWorker.getBugLoopWorkerStatus();
    bugLoopWorker.stopBugLoopWorker();

    expect(workerStatus.cycles).toBeGreaterThan(0);
    expect(workerStatus.errors).toBe(0);
    expect(closed).toBeTruthy();
    expect(closed.resolved_at).toBeTruthy();

    // 5.1 A correção foi EXECUTADA de verdade (não é "fechado sem prova"): task GREEN, tentativa
    // real, revisão aprovada e regressão registrada.
    const fixTask = await engineeringTaskService.getTask(triaged.fix_task_id);
    expect(fixTask.status).toBe('GREEN');
    const fixAttempts = await engineeringTaskService.listAttempts(triaged.fix_task_id);
    expect(fixAttempts.length).toBe(1); // o coder NÃO é reexecutado após o aval
    const regressionRuns = await engineeringTaskService.listRegressionRuns(fixAttempts[0].id).catch(() => []);
    expect(regressionRuns.length).toBeGreaterThan(0);

    // 5.2 A VERIFICAÇÃO DE GOVERNANÇA rodou DENTRO do ciclo (é ela que o fechamento consulta) e
    // foi autorizada — sem este veredito persistido o finding não fecharia (fail-closed).
    const verification = ((closed.triage || {}).ruleBaselineVerification) || null;
    expect(verification).toBeTruthy();
    expect(verification.ok).toBe(true);

    // 5.3 A AUTORIZAÇÃO auditável ficou PERSISTIDA no finding, com principal humano e permissão
    // específica verificada no ato do aval.
    const persistedApproval = ((closed.triage || {}).selfModificationApproval) || null;
    expect(persistedApproval).toBeTruthy();
    expect(persistedApproval.actor).toBe('operador-humano-qa');
    expect(persistedApproval.actorTypeVerified).toBe('HUMAN');
    expect(persistedApproval.hasSpecificPermission).toBe(true);
    expect(persistedApproval.governanceChangeApproved).toBe(true);
    expect(persistedApproval.reviewer).toBe('auditor-independente-qa');
  });
});

'use strict';

/**
 * E2E DO LOOP AUTÔNOMO DE BUG — prova em RUNTIME REAL, sem nova missão/ZIP/prompt.
 *
 * Cenário controlado (seguro): o "bug" está em um COMPONENTE INTERNO DE FIXTURE de engenharia
 * (`tests/fixtures/engineering-router-sandbox/mathUtils.js` não exporta `add`), e o teste do fixture
 * é RED por design — ele está em `jest.config.cjs#testPathIgnorePatterns` e por isso NUNCA roda nas
 * suítes normais; a reprodução o executa de propósito dentro de um workspace git isolado.
 *
 * O que roda de VERDADE aqui (nenhum dublê de execução):
 *   - detecção → finding SUSPECTED persistido em Postgres;
 *   - reprodução executada no sandbox Docker real, em git worktree isolado;
 *   - confirmação por BASE OBJETIVA (falha reproduzível) + evidência persistida;
 *   - triagem → EngineeringTask de correção com capability/risco derivados da categoria;
 *   - correção pelo ENGINE ROUTER REAL (classifier, policy, seleção de modelo, path boundary,
 *     patch validator, worktree, test runner em sandbox, reviewer independente, regression plan,
 *     governance gate) — o ÚNICO dublê é a chamada de rede ao LLM, via `registerAiProvider` REAL
 *     sob um id de provider REAL do registry, exatamente como o contrato exige;
 *   - FIXED só com reprodução verde + testes direcionados + parecer aprovado;
 *   - REGRESSION_VALIDATED a partir das execuções de regressão REAIS do Router;
 *   - retomada da MISSÃO ORIGINAL (mesma missão, sem reiniciar nada).
 *
 * Banco ou Docker indisponível ⇒ pulo EXPLÍCITO (nunca verde silencioso).
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const bugLoop = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_TEST_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-bug-loop';

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

const SUITE_NAME = 'engineering-bug-autonomous-loop-e2e';

/**
 * PULO REGISTRADO via porta única: em `RELEASE_AUTHORITATIVE=1` infraestrutura ausente (banco ou
 * sandbox Docker) lança `INFRA_ERROR` e a suite FALHA — nunca existe PASS sem provar o ciclo.
 */
function skipIfInfraMissing(available, reason, requirement) {
  if (available) return false;
  return skipOrFail({ suite: SUITE_NAME, available: false, reason, requirement });
}

function deleteCandidateBranchIfExists(taskId) {
  try {
    execFileSync('git', ['branch', '-D', `engineering-router/candidates/${taskId}`], { cwd: ROOT, stdio: 'ignore' });
  } catch (_) { /* branch pode não ter sido criada */ }
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

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }

  // RESÍDUO DE EXECUÇÃO INTERROMPIDA: o sweep do laço é GLOBAL por natureza —
  // findings deixados por execuções anteriores (timeout/kill, sem `afterAll`)
  // são reprocessados e competem com o finding DESTA suíte, e o ciclo não fecha
  // dentro do tempo (`fixed=0`, `closed=false`). Medido 2026-10-01 no lote
  // autoritativo. Mesmo remédio já aplicado em `engineeringBugLoop.test.js`.
  const { purgeTestFindings } = require('../helpers/purgeTestFindings');
  await purgeTestFindings();

  const { isSandboxAvailable } = require('../../api/services/engineeringRouter/executionSandbox');
  sandboxAvailable = isSandboxAvailable();

  const index = require('../../api/db/models');
  const TenantModel = index.getTenant();
  await TenantModel.findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Bug Loop', status: 'active', plan: 'enterprise' },
  });
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(TEST_TENANT_KEY, CODER_PROVIDER, `jest-fixture-fake-key-${CODER_PROVIDER}-${Date.now()}`);
  await saveAICredentials(TEST_TENANT_KEY, REVIEWER_PROVIDER, `jest-fixture-fake-key-${REVIEWER_PROVIDER}-${Date.now()}`);

  // O fake respeita EXATAMENTE o contrato real do provider (mesmo padrão do E2E do Router V1):
  // responde por `context.purpose`, que é como um provider real de fato atende CODER e REVIEWER.
  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        if (context.purpose === 'engineering_coder') {
          return { text: JSON.stringify({ summary: 'adiciona add() em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
        }
        if (context.purpose === 'engineering_reviewer') {
          return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
        }
        throw new Error(`[${label}] purpose inesperado: ${context.purpose}`);
      },
    };
  }
  registerAiProvider(CODER_PROVIDER, makeFakeProvider(CODER_PROVIDER));
  registerAiProvider(REVIEWER_PROVIDER, makeFakeProvider(REVIEWER_PROVIDER));
}, 60000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
  const index = require('../../api/db/models');
  try {
    for (const taskId of created.tasks) {
      deleteCandidateBranchIfExists(taskId);
      await cleanupTask(taskId);
    }
    const Event = index.getEngineeringBugFindingEvent();
    const Finding = index.getEngineeringBugFinding();
    if (created.findings.length) {
      await Event.destroy({ where: { finding_id: created.findings } }).catch(() => {});
      await Finding.destroy({ where: { id: created.findings } }).catch(() => {});
    }
    if (created.missions.length) await index.getEngineeringMission().destroy({ where: { id: created.missions } }).catch(() => {});
    const tenant = await index.getTenant().findOne({ where: { tenant_key: TEST_TENANT_KEY } });
    if (tenant) {
      await index.getTenantAICredential().destroy({ where: { tenant_id: tenant.id } }).catch(() => {});
      await index.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } }).catch(() => {});
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('BUG_AUTONOMOUS_LOOP — missão → bug → finding → reprodução → task → fix → regressão → missão', () => {
  jest.setTimeout(600000);

  test('o RAP descobre, reproduz, corrige e retoma a missão original sem novo ZIP/prompt/missão', async () => {
    if (skipIfInfraMissing(dbAvailable, `postgres_unreachable (${dbReason})`, 'postgres')) return;
    if (skipIfInfraMissing(sandboxAvailable, 'sandbox Docker indisponível — reprodução real impossível (não é prova)', 'docker')) return;

    // ── MISSÃO ORIGINAL (o bug acontece DENTRO dela) ──────────────────────────────────────────
    const index = require('../../api/db/models');
    const mission = await index.getEngineeringMission().create({
      title: 'missão original do E2E do loop de bug',
      original_mission: 'validar o pipeline de engenharia com o fixture controlado',
      original_mission_hash: 'e2e'.padEnd(64, '0'),
      mission_type: 'BUG_FIX',
      status: 'EXECUTING',
      risk: 'MEDIUM',
      allowed_paths: [FIXTURE_FILE],
    });
    created.missions.push(mission.id);

    // A missão tem a PRÓPRIA task (trabalho original). O bug não pode roubá-la nem substituí-la.
    const missionTask = await engineeringTaskService.createTask({
      title: 'task original da missão (não deve ser substituída pelo bug)',
      objective: 'trabalho original da missão',
      taskType: 'BUG_FIX',
      risk: 'MEDIUM',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
    }, { createdBy: 'jest-e2e' });
    created.tasks.push(missionTask.id);
    await missionStore.linkTask({ missionId: mission.id, taskId: missionTask.id });

    // ── O BUG MANIFESTA (anomalia detectada no contexto da missão) ────────────────────────────
    const report = await bugLoop.handleAnomaly({
      missionId: mission.id,
      taskId: missionTask.id,
      source: 'E2E_TEST',
      title: 'fixture mathUtils não exporta add()',
      description: 'o teste do fixture controlado reprova: add não é uma função',
      category: 'BUG',
      objectiveSeverity: 'HIGH', // HIGH exercita a exigência real de revisor INDEPENDENTE
      subsystem: 'TEST_FIXTURE',
      symbol: 'mathUtils.add',
      expectedBehavior: 'mathUtils exporta add(a,b) somando corretamente',
      observedBehavior: 'add is not a function',
      affectedFiles: [FIXTURE_FILE],
      affectedSubsystems: ['TEST_FIXTURE'],
      reproduction: { command: FIXTURE_TEST_COMMAND, expect: 'FAIL' },
      evidenceRefs: [{ type: 'TEST_REPORT', ref: 'fixture:mathUtils.test.js', detail: 'fixture RED por design' }],
    }, {
      actor: 'jest-e2e',
      autoReproduce: true,
      autoTriage: true,
      autoFix: true,
      maxAttempts: 1,
      allowedPaths: [FIXTURE_FILE],
      policy: { credentialScope: TEST_TENANT_KEY },
    });
    created.findings.push(report.finding.id);

    // ── 1. DETECÇÃO + REPRODUÇÃO + CONFIRMAÇÃO ───────────────────────────────────────────────
    expect(report.reproduced).toBe('REPRODUCED');
    expect(report.confirmed).toBe(true);
    expect(report.finding.confirmation_basis).toBe('REPRODUCED_TEST_FAILURE');

    // ── 2. TASK DE CORREÇÃO criada e roteada por capability ──────────────────────────────────
    expect(report.triaged.fixTask).toBeTruthy();
    const fixTaskId = report.triaged.fixTask.id;
    created.tasks.push(fixTaskId);
    expect(report.triaged.fixTask.title).toContain(report.finding.id);
    expect(report.triaged.assessment.capabilities.coder).toContain('CODING');
    expect(report.triaged.assessment.requiresIndependentReviewer).toBe(true);

    // ── 3. CORREÇÃO pelo Router REAL + FIXED só com as três provas + REGRESSÃO real ──────────
    expect(report.fix.fixed).toBe(true);
    expect(report.fix.regressionValidated).toBe(true);
    expect(report.fix.closed).toBe(true);
    expect(report.fix.evidence).toMatchObject({ reproductionPassed: true, targetedTestsPassed: true, reviewPassed: true });
    expect(report.fix.evidence.regressionRuns).toBeGreaterThan(0);

    const fixTask = await engineeringTaskService.getTask(fixTaskId);
    expect(fixTask.status).toBe('GREEN');
    const attempts = await engineeringTaskService.listAttempts(fixTaskId);
    expect(attempts.length).toBeGreaterThan(0);
    // HIGH ⇒ CODER e REVIEWER em providers DIFERENTES (a regra real da policy foi exercitada).
    expect(attempts[0].coder_provider).toBe(CODER_PROVIDER);
    const reviews = await engineeringTaskService.listReviews(attempts[attempts.length - 1].id);
    expect(reviews.some((r) => r.decision === 'APPROVE' && r.reviewer_provider === REVIEWER_PROVIDER)).toBe(true);

    // ── 4. CICLO CONCLUÍDO com evidência: FIXED → REGRESSION_VALIDATED → CLOSED ───────────────
    const finalFinding = await bugFindingService.getFinding(report.finding.id);
    expect(finalFinding.status).toBe('CLOSED');
    expect(finalFinding.fix_task_id).toBe(fixTaskId);
    expect(finalFinding.recurrence_count).toBe(0);
    const evidenceTypes = finalFinding.evidence_refs.map((e) => e.type);
    expect(evidenceTypes).toContain('REPRODUCTION_RESULT');
    expect(evidenceTypes).toContain('REVIEW_VERDICT');
    expect((finalFinding.regression_runs || []).length).toBeGreaterThan(0);

    const history = await bugFindingService.getFindingHistory(report.finding.id);
    const historyTypes = history.map((e) => e.type);
    expect(historyTypes).toContain('REPRODUCTION_ATTEMPTED');
    expect(historyTypes).toContain('FIX_TASK_LINKED');
    expect(historyTypes).toContain('FIX_APPLIED');
    expect(historyTypes).toContain('REGRESSION_VALIDATED');
    expect(historyTypes).toContain('STATUS_CHANGED');

    // ── 5. MISSÃO ORIGINAL CONTINUA ──────────────────────────────────────────────────────────
    expect(report.missionContinuation.resumed).toBe(true);
    const missionAfter = await missionStore.getMission(mission.id);
    expect(missionAfter.id).toBe(mission.id);
    expect(missionAfter.original_mission).toBe('validar o pipeline de engenharia com o fixture controlado');
    expect(missionAfter.linked_task_id).toBe(missionTask.id);
    expect(missionAfter.status).toBe('EXECUTING');

    const resumable = await missionStore.findResumableMissions({ limit: 200 });
    expect(resumable.some((m) => m.id === mission.id)).toBe(true);

    // Nenhuma missão nova foi criada para o bug (o ciclo voltou para a MESMA missão).
    //
    // ESCOPO POR EXECUÇÃO, nunca pelo banco inteiro. O banco é COMPARTILHADO e pode conter missões
    // RESIDUAIS do mesmo fixture, deixadas por execuções interrompidas — medido em 2026-10-03: uma
    // missão órfã (mission_source_state=PENDING, base de commit nula) de um run anterior fez um
    // `toHaveLength(1)` global falhar; como `jest.config.cjs` tem `bail: 1`, essa única falha
    // abortou o lote e deixou mais 5 suítes NOT_EXECUTED, o que por sua vez marcou a execução
    // autoritativa como FAIL. Asserção que depende de estado global acumulado transforma resíduo
    // de uma execução em falha de outra.
    //
    // A propriedade que importa continua sendo provada, e mais precisamente: o ciclo NÃO criou
    // missão nova. Qualquer missão criada a partir desta execução faria a contagem passar de 1.
    const missions = await index.getEngineeringMission().findAll({ where: { original_mission: 'validar o pipeline de engenharia com o fixture controlado' } });
    const createdFromThisRun = missions.filter((m) => m.id === mission.id || m.createdAt >= mission.createdAt);
    expect(createdFromThisRun).toHaveLength(1);
    expect(createdFromThisRun[0].id).toBe(mission.id);
  });

  test('o patch do ciclo de bug NUNCA altera o working tree principal (isolamento real)', () => {
    const content = fs.readFileSync(path.join(ROOT, FIXTURE_FILE), 'utf8');
    expect(content).toContain('module.exports = { multiply };');
    expect(content).not.toContain('function add');
  });

  test('SELF_MODIFICATION em runtime: fix no gate de governança NÃO roda sem aprovação humana', async () => {
    if (skipIfInfraMissing(dbAvailable, `postgres_unreachable (${dbReason})`, 'postgres')) return;

    const report = await bugLoop.handleAnomaly({
      source: 'GOVERNANCE_INCONSISTENCY',
      title: 'invariante do gate de bug violado em runtime',
      description: 'o gate declarado GO com evidência insuficiente',
      category: 'GOVERNANCE',
      objectiveSeverity: 'CRITICAL',
      subsystem: 'GOVERNANCE',
      invariant: 'bug-autonomous-loop:gate-direction',
      affectedFiles: ['scripts/governance/validate-bug-autonomous-loop.js'],
      invariantOutcome: 'GO',
      childOutcome: 'NO_GO',
      reproduction: { invariants: [{ id: 'bug-autonomous-loop:gate-direction' }] },
      evidenceRefs: [{ type: 'INVARIANT_EVALUATION', ref: 'gate:direction', detail: 'GO com filho NO_GO' }],
    }, {
      actor: 'jest-e2e',
      autoReproduce: true,
      autoTriage: true,
      autoFix: true,
      invariantResults: [{ id: 'bug-autonomous-loop:gate-direction', violated: true, detail: 'GO com filho NO_GO' }],
      allowedPaths: ['scripts/governance/validate-bug-autonomous-loop.js'],
      policy: { credentialScope: TEST_TENANT_KEY },
    });
    created.findings.push(report.finding.id);
    if (report.triaged?.fixTask?.id) created.tasks.push(report.triaged.fixTask.id);

    expect(report.confirmed).toBe(true);
    expect(report.finding.severity).toBe('CRITICAL');
    expect(report.finding.self_modification).toBe(true);
    expect(report.finding.human_approval_required).toBe(true);
    expect(report.finding.auto_approval_forbidden).toBe(true);

    // O trabalho EXISTE (task criada), mas NÃO foi executado autonomamente.
    expect(report.triaged.fixTask).toBeTruthy();
    expect(report.fix.blocked).toBe(true);
    expect(report.fix.code).toBe('SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED');
    expect(report.fix.executed).toBe(false);
    const task = await engineeringTaskService.getTask(report.triaged.fixTask.id);
    expect(['CLASSIFIED', 'ROUTED']).toContain(task.status);
  });
});

'use strict';

/**
 * E2E DO CAMINHO NATURAL DO LAÇO DE BUGS (sem NENHUMA chamada manual ao laço).
 *
 * Diferença essencial em relação a `engineeringBugAutonomousLoopE2E.test.js`: aqui NÃO se chama
 * `handleAnomaly`, `runFixLoop` nem `runBugLoopSweep`. O teste:
 *
 *   1. compila e APROVA uma missão real e a inicia pelo caminho de produção
 *      (`compiler.compileMission` → `approvalService.approve` → `orchestrator.startExecution`);
 *   2. executa a task da missão com um comando de teste REALMENTE RED (fixture controlado), pelo
 *      MESMO caminho que a rota usa (`orchestrator.runMissionTask`) — a falha é NATURAL;
 *   3. verifica que o finding nasceu do hook automático (`hookMissionFailure`), com plano de
 *      reprodução DERIVADO do contexto real (não fornecido pelo teste);
 *   4. sobe o WORKER AUTOMÁTICO (`bugLoopWorker.runBugLoopCycle`) e espera o sistema se recuperar
 *      sozinho: reprodução → confirmação → task de correção → Router corrige → regressão →
 *      finding CLOSED → MISSÃO ORIGINAL RETOMADA (task substituta registrada na linhagem).
 *
 * Infra ausente (Postgres/sandbox Docker) ⇒ pulo EXPLÍCITO; com RELEASE_AUTHORITATIVE=1 a ausência
 * lança INFRA_ERROR — nunca PASS silencioso.
 *
 * REQUISITOS QUE ESTA SUÍTE PROVA (declarados em config/engineering-bug-loop-required-tests.json):
 *   - AUTOMATIC_BUG_WORKER — a missão real que falha acorda o worker sozinho; nenhum `sweep` manual
 *     é chamado neste arquivo (é a diferença essencial em relação ao E2E antigo);
 *   - AUTOMATIC_REPRODUCTION_DERIVATION — o plano de reprodução do finding é DERIVADO do contexto
 *     real da falha (comando declarado no contrato da task), não fornecido pelo teste;
 *   - REAL_MISSION_CONTINUATION — a missão ORIGINAL volta a executar depois do bug corrigido;
 *   - REAL_ORIGINAL_TASK_RESUME — a retomada é EXECUÇÃO: existe task substituta com tentativa real.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const bugLoopWorker = require('../../api/services/engineeringMission/bugLoopWorker');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_TEST_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-bug-natural';

const SUITE_NAME = 'engineering-bug-loop-natural-path-e2e';

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

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }

  const { isSandboxAvailable } = require('../../api/services/engineeringRouter/executionSandbox');
  sandboxAvailable = isSandboxAvailable();

  const index = require('../../api/db/models');
  const TenantModel = index.getTenant();
  await TenantModel.findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Bug Loop Natural', status: 'active', plan: 'enterprise' },
  });
  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        const promptText = String(prompt || '');
        // O dublê simula um coder que NÃO consegue resolver a tarefa ORIGINAL da missão (por isso
        // a falha é natural e o finding nasce dela). Na correção do bug — que o laço abre sozinho —
        // o mesmo provider devolve o patch correto. Nenhum atalho de caminho: quem decide é o
        // prompt real montado pelo Router.
        const isOriginalMissionStep = promptText.includes(ORIGINAL_STEP_MARKER);
        if (context.purpose === 'engineering_coder') {
          if (isOriginalMissionStep) {
            return { text: JSON.stringify({ summary: 'não foi possível corrigir nesta etapa', diff: '' }), usage: { prompt_tokens: 90, completion_tokens: 10 } };
          }
          return { text: JSON.stringify({ summary: 'adiciona add() em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
        }
        if (context.purpose === 'engineering_reviewer') {
          return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
        }
        throw new Error(`[${label}] purpose inesperado: ${context.purpose}`);
      },
    };
  }

  // O Router escolhe o provider por capability/policy — o teste NÃO presume qual. Registra dublês
  // de LLM para todos os providers candidatos; o resto do caminho (patch, worktree, sandbox,
  // testes, reviewer, regressão) permanece REAL.
  const CANDIDATE_PROVIDERS = ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq'];
  for (const provider of CANDIDATE_PROVIDERS) {
    registerAiProvider(provider, makeFakeProvider(provider));
  }
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  for (const provider of CANDIDATE_PROVIDERS) {
    await saveAICredentials(TEST_TENANT_KEY, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
  }
}, 60000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
  const index = require('../../api/db/models');
  bugLoopWorker.stopBugLoopWorker();
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

describe('BUG_AUTONOMOUS_LOOP — CAMINHO NATURAL (sem sweep manual)', () => {
  jest.setTimeout(900000);

  test('task real falha → finding automático → worker deriva reprodução → corrige → retoma a missão', async () => {
    if (skipIfInfraMissing(dbAvailable, `postgres_unreachable (${dbReason})`, 'postgres')) return;
    if (skipIfInfraMissing(sandboxAvailable, 'sandbox Docker indisponível — reprodução real impossível (não é prova)', 'docker')) return;

    const index = require('../../api/db/models');

    // ── 1. MISSÃO REAL: compilada, aprovada e iniciada pelo caminho de produção ────────────────
    const compiled = await compiler.compileMission(
      `Repare a função de soma ausente em ${FIXTURE_FILE} sem quebrar a suíte existente.`,
      { createdBy: 'jest-natural' },
    );
    const mission = compiled.mission;
    created.missions.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-natural' });

    const started = await orchestrator.startExecution(mission.id, { actor: 'jest-natural', tenantId: 'system' });
    const originalTaskId = started.task.id;
    created.tasks.push(originalTaskId);

    // A task da missão passa a exercitar a fixture RED controlada (setup de fixture, não atalho de
    // caminho: a execução continua sendo orquestrador → Router → hook) e recebe um marcador no
    // objetivo que o dublê de LLM usa para simular "não consegui resolver nesta etapa".
    await index.getEngineeringTask().update(
      {
        test_commands: [FIXTURE_TEST_COMMAND],
        allowed_paths: [FIXTURE_FILE],
        objective: `${ORIGINAL_STEP_MARKER} corrigir a soma ausente na fixture controlada`,
      },
      { where: { id: originalTaskId } },
    );

    // ── 2. FALHA NATURAL: a task roda e NÃO termina GREEN (fixture RED) ────────────────────────
    const runResult = await orchestrator.runMissionTask(mission.id, { tenantId: 'system' });
    expect(runResult.result.status).not.toBe('GREEN');

    // ── 3. FINDING AUTOMÁTICO com plano DERIVADO do contexto real (o teste não informa nada) ──
    const findings = await bugFindingService.listFindings({ missionId: mission.id, limit: 10 });
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0];
    created.findings.push(finding.id);

    expect(finding.reproduction).toBeTruthy();
    expect(finding.reproduction.command).toBe(FIXTURE_TEST_COMMAND);
    expect(finding.reproduction.derivation).toMatchObject({ available: true });
    expect(['TEST_FAILURE', 'DECLARED_TEST_COMMAND', 'COMMAND_FAILURE']).toContain(finding.reproduction.derivation.strategy);

    // ── 4. WORKER AUTOMÁTICO: nada é chamado manualmente daqui para frente ────────────────────
    // O critério de parada é a RETOMADA registrada pelo próprio ciclo (o finding pode reabrir em
    // seguida por reincidência — ver 5.4), não o status momentâneo do registro.
    let sawResume = false;
    const cycles = [];
    for (let cycle = 0; cycle < 6 && !sawResume; cycle += 1) {
      const summary = await bugLoopWorker.runBugLoopCycle({ limit: 5, autoFix: true, actor: 'jest-natural-worker' });
      const current = await bugFindingService.getFinding(finding.id);
      const items = (summary.items || []).filter((item) => item.findingId === finding.id);
      cycles.push({
        cycle,
        status: current.status,
        summary: {
          scanned: summary.scanned, confirmed: summary.confirmed, triaged: summary.triaged,
          fixed: summary.fixed, resumed: summary.resumed, leaseSkipped: summary.leaseSkipped,
          items,
        },
      });
      if (items.some((item) => item.action === 'MISSION_RESUME' && item.resumed)) sawResume = true;
    }
    if (!sawResume) console.log('DIAGNOSTICO_CICLOS=' + JSON.stringify(cycles));

    // ── 5. O CICLO FECHOU E A MISSÃO ORIGINAL RETOMOU SOZINHA ────────────────────────────────
    const allItems = cycles.flatMap((c) => c.summary.items || []);
    const closedItem = allItems.find((item) => item.closed === true) || null;
    const resumeItem = allItems.find((item) => item.action === 'MISSION_RESUME' && item.resumed) || null;

    // 5.1 finding fechado de verdade: regressão REAL registrada (não basta "task terminou").
    expect(closedItem).toBeTruthy();
    const afterCycles = await bugFindingService.getFinding(finding.id);
    expect(afterCycles.regression_runs.length).toBeGreaterThan(0);

    // 5.2 a missão VOLTOU A EXECUTAR: task substituta criada pelo caminho canônico e executada.
    expect(resumeItem).toBeTruthy();
    expect(resumeItem.decision).toBe('REPLACE_TASK_RESUME_PHASE');
    expect(resumeItem.replacementTaskId).toBeTruthy();
    expect(resumeItem.replacementTaskId).not.toBe(originalTaskId);
    created.tasks.push(resumeItem.replacementTaskId);
    const replacementAttempts = await engineeringTaskService.listAttempts(resumeItem.replacementTaskId);
    expect(replacementAttempts.length).toBeGreaterThanOrEqual(1);

    // 5.3 LINHAGEM persistida e verificável na própria missão (auditoria do ciclo).
    const missionAfter = await missionStore.getMission(mission.id);
    const lineage = missionAfter?.resume_metadata?.bugLoop?.lineage || null;
    expect(lineage).toBeTruthy();
    expect(lineage.findingId).toBe(finding.id);
    expect(lineage.originalTaskId).toBe(originalTaskId);
    expect(lineage.fixTaskId).toBeTruthy();
    expect(lineage.replacementTaskId).toBe(resumeItem.replacementTaskId);

    // 5.4 REINCIDÊNCIA reconhecida — comportamento CORRETO deste cenário: o patch do laço vive em
    //     branch ISOLADO e nunca toca o working tree principal, então a fixture continua vermelha e
    //     a missão retomada falha de novo: o finding é reaberto como REINCIDÊNCIA (mesma identidade,
    //     sem duplicar registro) e a guarda de recursão passa a protegê-lo de laço infinito.
    expect(afterCycles.recurrence_count).toBeGreaterThanOrEqual(1);
  });
});

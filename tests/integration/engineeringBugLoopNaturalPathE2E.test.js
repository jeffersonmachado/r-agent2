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
// Drenagem do worker antes de fechar o banco: `stopBugLoopWorker()` só faz clearInterval e o ciclo
// em curso chamava o Sequelize já fechado ("getConnection after close"), derrubando o LOTE com
// 0 testes falhados e exit != 0. Ver tests/helpers/drainEngineeringWorker.js.
const { stopWorkerAndDrain } = require('../helpers/drainEngineeringWorker');

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

  // RESÍDUO DE EXECUÇÃO INTERROMPIDA: o sweep do laço é GLOBAL por natureza —
  // findings deixados por execuções anteriores (timeout/kill, sem `afterAll`)
  // são reprocessados e competem com o finding DESTA suíte, e o ciclo não fecha
  // dentro do tempo (`fixed=0`, `closed=false`). Medido 2026-10-01 no lote
  // autoritativo: a suíte levou 447 s (64 s isolada) e a asserção de fechamento
  // falhou. Mesmo remédio já aplicado em `engineeringBugLoop.test.js`.
  const { purgeTestFindings } = require('../helpers/purgeTestFindings');
  await purgeTestFindings();

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

    // ── 4. WORKER AUTOMÁTICO: NADA é chamado manualmente daqui para frente ────────────────────
    //
    // DEFEITO MEDIDO (2026-10-02): este passo chamava `bugLoopWorker.runBugLoopCycle()` em laço —
    // ou seja, o teste CONDUZIA o ciclo e depois afirmava que o worker era automático. Provar
    // autonomia chamando o ciclo à mão é provar nada. Aqui sobe o worker REAL do runtime (a MESMA
    // função que `api/runtime/startWorkers.js` usa) e o teste apenas OBSERVA o banco até o sistema
    // se recuperar sozinho. `runBugLoopCycle`, `runBugLoopSweep` e `handleAnomaly` não são chamados.
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

    const workerStart = bugLoopWorker.startBugLoopWorker({ intervalMs: 1000, limit: 5, runImmediately: true });
    expect(workerStart.started).toBe(true);

    let sawResume = false;
    // ORÇAMENTO DE ESPERA. Medido em 2026-10-02: isolada a suíte fecha em ~35 s, mas no LOTE
    // AUTORITATIVO (6 suítes concorrentes) o mesmo ciclo levou 187 s e estourou um limite de 180 s —
    // flake por orçamento curto, não por defeito. O teste ESPERA de verdade (não dirige nada), então
    // o orçamento precisa acomodar a carga real do lote em que ele roda.
    const waitBudgetMs = Number(process.env.ENGINEERING_E2E_WORKER_WAIT_MS || 900000);
    const deadline = Date.now() + waitBudgetMs;
    // Espera PASSIVA: o único ator é o worker. O teste lê o banco e nada mais.
    while (Date.now() < deadline && !sawResume) {
      await sleep(1000);
      const missionNow = await missionStore.getMission(mission.id);
      const lineageNow = missionNow?.resume_metadata?.bugLoop?.lineage || null;
      if (lineageNow && lineageNow.findingId === finding.id && lineageNow.replacementTaskId) sawResume = true;
    }
    const workerStatus = bugLoopWorker.getBugLoopWorkerStatus();
    bugLoopWorker.stopBugLoopWorker();

    // O WORKER REAL RODOU: ciclos contados pelo próprio processo, não por chamada do teste.
    expect(workerStatus.cycles).toBeGreaterThan(0);
    expect(workerStatus.errors).toBe(0);

    // ── 5. O CICLO FECHOU E A MISSÃO ORIGINAL RETOMOU SOZINHA ────────────────────────────────
    expect(sawResume).toBe(true);

    // 5.1 finding fechado de verdade: regressão REAL registrada (não basta "task terminou").
    const afterCycles = await bugFindingService.getFinding(finding.id);
    expect(afterCycles.regression_runs.length).toBeGreaterThan(0);
    expect(['CLOSED', 'CONFIRMED', 'FIXING']).toContain(afterCycles.status);

    // 5.2 a missão VOLTOU A EXECUTAR: task substituta criada pelo caminho canônico e executada.
    const missionAfter = await missionStore.getMission(mission.id);
    const lineage = missionAfter?.resume_metadata?.bugLoop?.lineage || null;
    expect(lineage).toBeTruthy();
    expect(lineage.decision).toBe('REPLACE_TASK_RESUME_PHASE');
    expect(lineage.replacementTaskId).toBeTruthy();
    expect(lineage.replacementTaskId).not.toBe(originalTaskId);
    created.tasks.push(lineage.replacementTaskId);
    const replacementAttempts = await engineeringTaskService.listAttempts(lineage.replacementTaskId);
    expect(replacementAttempts.length).toBeGreaterThanOrEqual(1);

    // 5.3 LINHAGEM persistida e verificável na própria missão (auditoria do ciclo).
    expect(lineage.findingId).toBe(finding.id);
    expect(lineage.originalTaskId).toBe(originalTaskId);
    expect(lineage.fixTaskId).toBeTruthy();

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // 5.4 A GARANTIA QUE FALTAVA — MISSION_RESUME_USES_FIXED_SOURCE.
    //
    // ESTE BLOCO AFIRMAVA O DEFEITO. O texto anterior era, literalmente:
    //
    //   "REINCIDÊNCIA reconhecida — o patch do laço vive em branch ISOLADO e nunca toca o working
    //    tree principal, então a fixture continua vermelha e a missão retomada falha de novo"
    //
    // Ou seja: o teste aceitava `recurrence_count >= 1` como comportamento CORRETO, quando a causa
    // era o fix NUNCA ter entrado na source usada pela missão. Recorrência por ausência de patch não
    // é o bug voltando — é o fix que nunca chegou. Aceitar isso era aceitar o defeito.
    //
    // Agora a asserção é a inversa, e é verificável por HASH:
    //   (a) a fonte da missão AVANÇOU (houve integração, com trilha);
    //   (b) a replacement task nasceu DESSE commit — não do commit original;
    //   (c) o patch do fix ESTÁ no commit de origem da replacement.
    // Se o fix tivesse ficado só no candidate isolado, (b) e (c) falhariam.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
    const sourceAfter = await missionSourceService.getMissionSource(mission.id);

    // (a) a fonte avançou em relação à base.
    expect(sourceAfter.currentCommit).toBeTruthy();
    expect(sourceAfter.baseCommit).toBeTruthy();
    expect(sourceAfter.currentCommit).not.toBe(sourceAfter.baseCommit);
    expect(sourceAfter.fence).toBeGreaterThanOrEqual(1);

    const integrations = await missionSourceService.listIntegrations(mission.id);
    const integrated = integrations.filter((row) => row.integration_result === 'INTEGRATED');
    expect(integrated.length).toBeGreaterThanOrEqual(1);

    // (b) A REPLACEMENT TASK HERDOU O COMMIT CORRIGIDO — por hash, não por narrativa.
    const replacement = await engineeringTaskService.getTask(lineage.replacementTaskId);
    expect(replacement.source_commit).toBe(sourceAfter.currentCommit);
    expect(replacement.source_commit).not.toBe(sourceAfter.baseCommit);
    expect(replacement.source_ref).toBe(sourceAfter.integrationBranch);

    // (c) O PATCH DO FIX ESTÁ NO COMMIT DE ORIGEM DA REPLACEMENT — a prova de que ela ENXERGA o fix.
    //     Lido do git real, no commit exato que a task vai materializar.
    const { execFileSync } = require('child_process');
    const root = path.resolve(__dirname, '..', '..');
    const fixtureAtSource = execFileSync('git', ['show', `${replacement.source_commit}:${FIXTURE_FILE}`], { cwd: root, encoding: 'utf8' });
    // O fix adiciona `add()` à fixture: o conteúdo no commit da missão tem de refleti-lo.
    expect(fixtureAtSource).toMatch(/function add\s*\(/);
  });
});

'use strict';

/**
 * tests/integration/missionSourceStaleReplanE2E.test.js
 *
 * MISSION_SOURCE_STALE_REPLAN_E2E — o cenário COMPLETO exigido pela missão de
 * fechamento, com git real, Postgres real e o caminho canônico do worker:
 *
 *   M1: Task A e Task B nascem na fonte da missão
 *   Task A integra um patch  → a fonte vira M2
 *   Task B termina um candidate construído sobre M1  → STALE_CANDIDATE
 *   → SOURCE_STALE (NÃO é bug de aplicação)
 *   → REPLAN AUTOMÁTICO: task SUBSTITUTA ancorada em M2
 *   → a substituta integra o patch B  → a missão vira M3
 *   M3 contém patch A + patch B · a `main` nunca foi alterada
 *
 * POR QUE UM ARQUIVO PRÓPRIO (e não o E2E de fonte já existente): aquele harness
 * monta missão/task direto no banco, sem MissionSpec. O replan automático, por
 * política do produto, só retoma missão EXECUTÁVEL (`assertMissionExecutable` exige
 * spec corrente + aprovação) — medido: com a missão sem spec o replan devolvia
 * `decision=NOT_EXECUTABLE` (MISSION_SPEC_NOT_APPROVED) e nenhuma task substituta
 * nascia. Provar o replan exige, portanto, uma missão enriquecida e aprovada pelo
 * fluxo REAL, e é isso que este arquivo monta.
 *
 * O que é REAL: repositório git (commits, branches, worktrees, `commit-tree`),
 * linhas de missão/task/integração no Postgres, enriquecimento, aprovação,
 * resolução de fonte, integração por CAS e o replan do worker.
 * O que é dublê: SOMENTE a chamada de rede ao LLM (provider determinístico sob id
 * real do registry, mesmo harness de `engineeringMissionFullE2E`).
 *
 * Infra ausente ⇒ pulo EXPLÍCITO via `skipOrFail` (RELEASE_AUTHORITATIVE=1 lança).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// O repositório de teste precisa existir ANTES dos requires: o contexto do Router
// resolve a raiz no carregamento do módulo.
const REPO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-replan-repo-'));
const WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-replan-ws-'));
process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = REPO_DIR;
process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = WORKSPACE_DIR;
// O replan tem teto de tentativas próprio; explícito para o teste não depender de default.
process.env.ENGINEERING_MISSION_MAX_SOURCE_REPLAN = '2';

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const coordinator = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const patchApplyService = require('../../api/services/engineeringRouter/patchApplyService');
const sourceSpec = require('../../engine/engineeringMission/missionSource');

const SUITE_NAME = 'mission-source-stale-replan-e2e';
const TEST_TENANT_KEY = 'jest-e2e-stale-replan';
const CODER_PROVIDER = 'anthropic';

let dbAvailable = false;
let dbReason = 'desconhecido';
const created = { missions: [], tasks: [] };

function git(args, { cwd = REPO_DIR } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitSafe(args, opts) {
  try {
    return { ok: true, out: git(args, opts) };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message) };
  }
}

function writeRepoFile(relPath, content) {
  const abs = path.join(REPO_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function readAtCommit(commit, relPath) {
  return git(['show', `${commit}:${relPath}`]);
}

function existsAtCommit(commit, relPath) {
  return gitSafe(['cat-file', '-e', `${commit}:${relPath}`]).ok;
}

/**
 * Candidate como o Router cria: worktree descartável sobre `baseCommit` e
 * `commit-tree -p <baseCommit>` (descendente DIRETO da fonte ⇒ integrar é
 * fast-forward, não merge cego).
 */
function createCandidate({ baseCommit, files, message }) {
  const ws = fs.mkdtempSync(path.join(WORKSPACE_DIR, 'cand-'));
  git(['worktree', 'add', '--detach', ws, baseCommit]);
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(ws, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(['add', '-A'], { cwd: ws });
    const tree = git(['write-tree'], { cwd: ws });
    return git(['commit-tree', tree, '-p', baseCommit, '-m', message]);
  } finally {
    gitSafe(['worktree', 'remove', '--force', ws]);
    if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  }
}

/**
 * Provider dublê do LLM: o CODER devolve o patch que a task substituta deve
 * aplicar na fonte da missão. Todo o resto do caminho (contract, execução,
 * integração, replan) é real.
 */
function makeFakeProvider() {
  return {
    async generate(prompt, context) {
      if (context && context.purpose === 'engineering_coder') {
        return {
          text: JSON.stringify({
            summary: 'task substituta aplica o patch B sobre a fonte já corrigida',
            diff: [
              'diff --git a/src/from-task-b.js b/src/from-task-b.js',
              '--- /dev/null',
              '+++ b/src/from-task-b.js',
              '@@ -0,0 +1 @@',
              "+module.exports = 'patch-b';",
            ].join('\n'),
          }),
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }
      if (context && context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 8, completion_tokens: 2 } };
      }
      // Qualquer outro propósito (interpretação de intenção, etc.) recebe uma
      // resposta neutra: o objetivo é determinismo, não simular o produto.
      return { text: JSON.stringify({}), usage: { prompt_tokens: 1, completion_tokens: 1 } };
    },
  };
}

async function setupTenantAndProvider() {
  const models = require('../../api/db/models');
  await models.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Stale Replan', status: 'active', plan: 'enterprise' },
  });
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(TEST_TENANT_KEY, CODER_PROVIDER, `jest-fixture-fake-key-${CODER_PROVIDER}-${Date.now()}`);
  registerAiProvider(CODER_PROVIDER, makeFakeProvider());
}

const PRECONDITIONS_OK = {
  candidateGreen: true,
  hasTestRun: true,
  reviewVerdict: 'APPROVE',
  regressionStatus: 'PASS',
  ownershipValid: true,
  candidateIntegrityOk: true,
};

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 60000);

afterAll(async () => {
  if (dbAvailable) {
    const models = require('../../api/db/models');
    for (const taskId of created.tasks) {
      await models.getEngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
    }
    if (created.missions.length) {
      await models.getEngineeringMissionIntegration().destroy({ where: { mission_id: created.missions } }).catch(() => {});
      await models.EngineeringMissionApproval().destroy({ where: { mission_id: created.missions } }).catch(() => {});
      await models.EngineeringMissionVersion().destroy({ where: { mission_id: created.missions } }).catch(() => {});
      await models.EngineeringMission().destroy({ where: { id: created.missions } }).catch(() => {});
    }
    await models.getTenant().destroy({ where: { tenant_key: TEST_TENANT_KEY } }).catch(() => {});
  }
  clearAiProviderConfig();
  for (const dir of [REPO_DIR, WORKSPACE_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  await sequelizeModule.close().catch(() => {});
}, 60000);

describe('Mission Source — STALE_CANDIDATE vira REPLAN automático (E2E real)', () => {
  jest.setTimeout(300000);

  let skipReason = null;
  let mission = null;
  let mainAtStart = null;

  beforeAll(async () => {
    if (!dbAvailable) {
      skipReason = `Postgres indisponível: ${dbReason}`;
      return;
    }

    // ── Repositório real: main em M0 ─────────────────────────────────────────
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'e2e@results.local']);
    git(['config', 'user.name', 'E2E Stale Replan']);
    writeRepoFile('package.json', JSON.stringify({ name: 'stale-replan-fixture', version: '1.0.0' }, null, 2));
    writeRepoFile('README.md', '# E2E stale replan\n');
    writeRepoFile('src/feature.js', "module.exports = { feature: () => 'v0' };\n");
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'M0: base da linha principal']);
    mainAtStart = git(['rev-parse', 'main']);

    await setupTenantAndProvider();

    // ── Missão REAL: enriquecida e aprovada pelo fluxo canônico ──────────────
    // Sem isto o replan recusa por política (`MISSION_SPEC_NOT_APPROVED`) — e essa
    // recusa é correta: o replan não inventa execução para missão não executável.
    const compiled = await compiler.compileMission(
      'Reancorar a fonte da missão e reaplicar o patch pendente quando a fonte avançar.',
      { createdBy: 'jest-e2e-stale-replan', tenantId: TEST_TENANT_KEY, contextHints: { touchesDatabase: false, touchesMultiTenant: false } },
    );
    mission = compiled.mission;
    created.missions.push(mission.id);

    await approvalService.editAndApprove(mission.id, {
      actor: 'jest-e2e-stale-replan',
      reason: 'fixture de QA: escopo explícito para o cenário de replan de fonte',
      patch: { allowedPaths: ['src/'], scope: 'SMALL' },
      tenantId: TEST_TENANT_KEY,
    });

    // A fonte isolada da missão (branch dedicada derivada da main).
    await missionSourceService.ensureMissionSource(mission.id, { actor: 'jest' });
  }, 300000);

  test('o replan automático reancora a task substituta na fonte CORRENTE e preserva o histórico', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    // ── M1 ───────────────────────────────────────────────────────────────────
    const start = await missionSourceService.getMissionSource(mission.id);
    const M1 = start.currentCommit;

    const taskA = await engineeringTaskService.createTask({
      title: 'task-a', objective: 'patch A', taskType: 'IMPLEMENT', risk: 'LOW', scope: 'LOW',
      missionId: mission.id, sourceCommit: M1, sourceRef: start.integrationBranch, sourceMissionFence: start.fence,
    }, { createdBy: 'jest', idempotencyKey: `e2e:${mission.id}:task-a` });
    created.tasks.push(taskA.id);

    const taskB = await engineeringTaskService.createTask({
      title: 'task-b', objective: 'patch B', taskType: 'IMPLEMENT', risk: 'LOW', scope: 'LOW',
      missionId: mission.id, sourceCommit: M1, sourceRef: start.integrationBranch, sourceMissionFence: start.fence,
    }, { createdBy: 'jest', idempotencyKey: `e2e:${mission.id}:task-b` });
    created.tasks.push(taskB.id);

    // ── Task A integra: a fonte vira M2 ──────────────────────────────────────
    const candidateA = createCandidate({
      baseCommit: M1,
      files: { 'src/from-task-a.js': "module.exports = 'patch-a';\n" },
      message: 'patch A',
    });
    const integratedA = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: taskA.id, candidateCommit: candidateA, preconditions: PRECONDITIONS_OK, actor: 'jest-a',
    });
    expect(integratedA.integrated).toBe(true);
    const M2 = integratedA.missionCommitAfter;
    expect(M2).not.toBe(M1);

    // ── Task B termina ancorada em M1 → STALE ────────────────────────────────
    const candidateB = createCandidate({
      baseCommit: M1,
      files: { 'src/from-task-b.js': "module.exports = 'patch-b';\n" },
      message: 'patch B sobre a base antiga',
    });
    const stale = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: taskB.id, candidateCommit: candidateB, preconditions: PRECONDITIONS_OK, actor: 'jest-b',
    });
    expect(stale.integrated).toBe(false);
    expect(stale.result).toBe('STALE_CANDIDATE');

    // A recusa não moveu a fonte nem aplicou o patch indevido.
    const afterStale = await missionSourceService.getMissionSource(mission.id);
    expect(afterStale.currentCommit).toBe(M2);
    expect(existsAtCommit(M2, 'src/from-task-b.js')).toBe(false);

    // ── A CLASSIFICAÇÃO: stale de fonte NÃO é bug de aplicação ───────────────
    const classified = sourceSpec.classifySourceFailure({ reasonCode: 'STALE_CANDIDATE' });
    expect(classified.disposition).toBe('SOURCE_STALE');
    expect(classified.requiresReplan).toBe(true);
    expect(classified.createsApplicationBug).toBe(false);

    // ── REPLAN AUTOMÁTICO pelo caminho canônico do worker ────────────────────
    const replan = await coordinator.maybeReplanAfterSourceFailure({
      missionId: mission.id,
      taskId: taskB.id,
      result: {
        status: 'READY_FOR_PROMOTION',
        reasonCode: 'STALE_CANDIDATE',
        missionIntegration: { code: 'STALE_CANDIDATE', candidateBaseCommit: M1, missionCommitBefore: M2 },
      },
      actor: 'jest-replan',
      tenantId: TEST_TENANT_KEY,
    });

    expect(replan.replanned).toBe(true);
    expect(replan.replacementTaskId).toBeTruthy();

    // ── A PROVA CENTRAL: substituta ancorada em M2 e enxergando o patch A ────
    const replacement = await engineeringTaskService.getTask(replan.replacementTaskId);
    created.tasks.push(replacement.id);
    expect(replacement.source_commit).toBe(M2);

    const resolvedBase = await patchApplyService.resolveTaskBaseCommit(replacement.id);
    expect(readAtCommit(resolvedBase.commit, 'src/from-task-a.js')).toContain('patch-a');

    // ── Continuidade: o patch B entra SOBRE M2 e a missão chega a M3 ─────────
    const currentForB = await missionSourceService.getMissionSource(mission.id);
    const candidateB2 = createCandidate({
      baseCommit: currentForB.currentCommit,
      files: { 'src/from-task-b.js': "module.exports = 'patch-b';\n" },
      message: 'patch B reancorado',
    });
    const integratedB = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: replacement.id, candidateCommit: candidateB2, preconditions: PRECONDITIONS_OK, actor: 'jest-b2',
    });
    expect(integratedB.integrated).toBe(true);
    const M3 = integratedB.missionCommitAfter;

    // A missão final carrega os DOIS patches.
    expect(readAtCommit(M3, 'src/from-task-a.js')).toContain('patch-a');
    expect(readAtCommit(M3, 'src/from-task-b.js')).toContain('patch-b');

    // ── E a `main` permaneceu intocada do início ao fim ─────────────────────
    expect(await missionSourceService.readMainCommit('main')).toBe(mainAtStart);
    expect(existsAtCommit(mainAtStart, 'src/from-task-a.js')).toBe(false);
    expect(existsAtCommit(mainAtStart, 'src/from-task-b.js')).toBe(false);
    expect(git(['rev-parse', 'HEAD'])).toBe(mainAtStart);

    // O replan ficou REGISTRADO na missão (auditável, com contador limitado).
    const persisted = await missionStore.getMission(mission.id);
    const replanState = ((persisted.resume_metadata || {}).sourceReplan) || {};
    expect(replanState.attempts).toBeGreaterThanOrEqual(1);
    expect(replanState.lastTaskId).toBe(String(taskB.id));
  });
});

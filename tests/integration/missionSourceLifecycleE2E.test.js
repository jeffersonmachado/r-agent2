'use strict';

/**
 * tests/integration/missionSourceLifecycleE2E.test.js
 *
 * CAICHO DE VIDA DA FONTE DA MISSÃO — as janelas de crash que o crash-window E2E (update-ref ↔ CAS)
 * NÃO cobria:
 *
 *   INIT-CRASH-01  intent de inicialização PREPARED, branch AUSENTE  → recovery recria a branch;
 *   INIT-CRASH-02  branch criada, DB ainda SEM source               → recovery FINALIZA o banco
 *                                                                    (nunca acusa tamper);
 *   INIT-TAMPER-01 branch existe SEM InitializationIntent           → UNTRUSTED (fail-closed);
 *   DELETE-01      branch apagada, DB + receipt provam M3           → recriada em M3 (NUNCA main);
 *   DELETE-02      branch apagada, proveniência NÃO prova M3        → RECOVERY_REQUIRED.
 *
 * DEFEITOS QUE ESTE TESTE TRAVA (confirmados no código em 2026-10-03):
 *   - `ensureMissionSource` criava a branch ANTES de persistir qualquer coisa: morte no meio deixava
 *     uma branch de missão que nenhum registro autorizava (e o boot seguinte a classificava como
 *     divergência, ou a adotava);
 *   - branch apagada caía no caminho de criação a partir da ORIGEM: a missão voltava para a `main`
 *     (M0) e perdia TODAS as integrações em silêncio — a causa real do sintoma "o bug reapareceu".
 *
 * git REAL + linhas REAIS no Postgres. Infra ausente ⇒ `skipOrFail` (com RELEASE_AUTHORITATIVE=1 a
 * ausência é INFRA_ERROR, nunca PASS silencioso).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-lifecycle-e2e-'));
const WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-lifecycle-ws-'));
process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = REPO_DIR;
process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = WORKSPACE_DIR;

const { skipOrFail } = require('../helpers/infraGate');
const sequelizeModule = require('../../api/db/sequelize');
const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const source = require('../../engine/engineeringMission/missionSource');

const SUITE_NAME = 'mission-source-lifecycle-e2e';

let skipReason = null;
const created = { missions: [] };

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

function branchFor(missionId) {
  return source.buildIntegrationBranchName(missionId);
}

beforeAll(async () => {
  try {
    git(['--version']);
  } catch (err) {
    skipReason = `git indisponível: ${err.message}`;
    return;
  }
  try {
    await sequelizeModule.connect(2, 250);
  } catch (error) {
    skipReason = `Postgres indisponível: ${error.message}`;
    return;
  }

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'jest@local']);
  git(['config', 'user.name', 'jest']);
  fs.writeFileSync(path.join(REPO_DIR, 'README.md'), 'base\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
}, 60000);

afterAll(async () => {
  try {
    const models = require('../../api/db/models');
    if (models.EngineeringMissionIntegration && created.missions.length > 0) {
      await models.EngineeringMissionIntegration().destroy({ where: { mission_id: created.missions } });
    }
    if (models.EngineeringMission && created.missions.length > 0) {
      await models.EngineeringMission().destroy({ where: { id: created.missions } });
    }
  } catch (err) {
    // limpeza best-effort: nunca mascarar o veredito
  }
  for (const dir of [REPO_DIR, WORKSPACE_DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { /* idem */ }
  }
});

/** Commit filho de `baseCommit` (fast-forward candidate), criado por `commit-tree`. */
function createCommit({ baseCommit, message }) {
  const ws = fs.mkdtempSync(path.join(WORKSPACE_DIR, 'c-'));
  git(['worktree', 'add', '--detach', ws, baseCommit]);
  try {
    fs.writeFileSync(path.join(ws, 'change.txt'), `${message}\n`);
    git(['add', '-A'], { cwd: ws });
    const tree = git(['write-tree'], { cwd: ws });
    return git(['commit-tree', tree, '-p', baseCommit, '-m', message]);
  } finally {
    gitSafe(['worktree', 'remove', '--force', ws]);
  }
}

async function createMissionRow() {
  const { EngineeringMission } = require('../../api/db/models');
  const Mission = EngineeringMission();
  const row = await Mission.create({
    title: `E2E lifecycle ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    original_mission: 'Provar o ciclo de vida da fonte da missão (init crash-safe e branch apagada).',
    original_mission_hash: `lifecycle-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    mission_type: 'INVESTIGATION',
    risk: 'LOW',
    scope: 'LOW',
    status: 'EXECUTING',
    branch: 'main',
  });
  created.missions.push(row.id);
  return row.id;
}

async function readMission(missionId) {
  const { EngineeringMission } = require('../../api/db/models');
  const row = await EngineeringMission().findByPk(missionId);
  const plain = row && row.get ? row.get({ plain: true }) : row;
  return plain || null;
}

async function setSource(missionId, patch) {
  const { EngineeringMission } = require('../../api/db/models');
  await EngineeringMission().update(patch, { where: { id: missionId } });
}

/** Receipt de integração INTEGRADA — a PROVENIÊNCIA que autoriza recriar a branch no commit. */
async function createIntegratedReceipt({ missionId, candidateCommit, missionCommitBefore, missionCommitAfter }) {
  const { EngineeringMissionIntegration } = require('../../api/db/models');
  const Integration = EngineeringMissionIntegration();
  return Integration.create({
    mission_id: missionId,
    task_id: null,
    integration_type: 'TASK_CANDIDATE',
    integration_result: 'INTEGRATED',
    integration_status: 'COMMITTED',
    candidate_commit: candidateCommit,
    candidate_base_commit: missionCommitBefore,
    mission_commit_before: missionCommitBefore,
    mission_commit_after: missionCommitAfter,
    integration_branch: branchFor(missionId),
    integration_key: `receipt:${missionId}:${candidateCommit}`,
    source_fence: 0,
    tests: [], review: {}, regression: {}, evidence: {},
  });
}

describe('ciclo de vida da fonte da missão (init crash-safe + branch apagada)', () => {
  test('INIT-CRASH-01 intent PREPARED e branch AUSENTE ⇒ recovery RECRIA a branch na base autorizada', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionRow();
    const branch = branchFor(missionId);

    // Janela: o intent foi persistido e o processo morreu ANTES do `git branch`.
    const init = await missionSourceService.prepareInitializationIntent({
      missionId, baseCommit: base, integrationBranch: branch, sourceRef: 'main',
    });
    expect(init.intent.integration_status).toBe('PREPARED');
    expect(gitSafe(['rev-parse', '--verify', `refs/heads/${branch}`]).ok).toBe(false);

    // Recovery (outro processo) varre os intents não-terminais.
    const reconciled = await missionSourceService.reconcileMissionSourceIntents({ missionId });
    expect(reconciled.outcomes.some((o) => o.kind === 'INITIALIZATION')).toBe(true);

    // A branch foi recriada na base AUTORIZADA e o banco passou a ter source.
    expect(git(['rev-parse', branch])).toBe(base);
    const mission = await readMission(missionId);
    expect(mission.mission_current_commit).toBe(base);
    expect(mission.mission_source_state).toBe('READY');
    // Inicialização NÃO é avanço de commit: o fence permanece 0.
    expect(Number(mission.mission_source_fence)).toBe(0);
  }, 120000);

  test('INIT-CRASH-02 branch criada e DB ainda SEM source ⇒ recovery FINALIZA o banco (nunca acusa tamper)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionRow();
    const branch = branchFor(missionId);

    // Janela: intent PREPARED + `git branch` efetivado, mas o processo morreu ANTES do UPDATE.
    await missionSourceService.prepareInitializationIntent({
      missionId, baseCommit: base, integrationBranch: branch, sourceRef: 'main',
    });
    git(['branch', branch, base]);
    const before = await readMission(missionId);
    expect(before.mission_current_commit).toBeNull();

    // `ensureMissionSource` reconcilia ANTES de julgar: o estado é legítimo, não tamper.
    const src = await missionSourceService.ensureMissionSource(missionId, { actor: 'jest-lifecycle' });
    expect(src.currentCommit).toBe(base);
    expect(src.state).toBe('READY');

    const after = await readMission(missionId);
    expect(after.mission_current_commit).toBe(base);
    expect(after.mission_base_commit).toBe(base);
    expect(Number(after.mission_source_fence)).toBe(0);
  }, 120000);

  test('INIT-TAMPER-01 branch existe SEM InitializationIntent ⇒ UNTRUSTED (fail-closed)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionRow();
    const branch = branchFor(missionId);

    // Branch de missão SEM intent: escrita externa (push manual/rebase/outro worktree).
    git(['branch', branch, base]);

    await expect(missionSourceService.ensureMissionSource(missionId, { actor: 'jest-lifecycle' }))
      .rejects.toMatchObject({ code: 'UNTRUSTED_MISSION_SOURCE_INITIALIZATION' });

    const mission = await readMission(missionId);
    expect(mission.mission_source_state).toBe('DIVERGENCE');
    expect(mission.mission_current_commit).toBeNull();
  }, 120000);

  test('DELETE-01 branch apagada com DB + receipt provando M3 ⇒ RECRIADA em M3 (NUNCA na main)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const m0 = git(['rev-parse', 'main']);
    const missionId = await createMissionRow();
    const branch = branchFor(missionId);
    git(['branch', branch, m0]);

    const m2 = createCommit({ baseCommit: m0, message: 'M2' });
    const m3 = createCommit({ baseCommit: m2, message: 'M3' });

    // Estado autoritativo: a missão avançou até M3, com receipt que PROVA o commit.
    await setSource(missionId, {
      mission_source_ref: 'main', mission_base_commit: m0, mission_integration_branch: branch,
      mission_current_commit: m3, mission_source_state: 'READY', mission_source_fence: 2,
    });
    await createIntegratedReceipt({ missionId, candidateCommit: m3, missionCommitBefore: m2, missionCommitAfter: m3 });

    // A branch é APAGADA (gc/prune/limpeza manual).
    git(['branch', '-D', branch]);
    expect(gitSafe(['rev-parse', '--verify', `refs/heads/${branch}`]).ok).toBe(false);

    const src = await missionSourceService.ensureMissionSource(missionId, { actor: 'jest-lifecycle' });

    // Recriada no commit AUTORITATIVO — jamais em m0/main.
    expect(git(['rev-parse', branch])).toBe(m3);
    expect(src.currentCommit).toBe(m3);
    expect(src.currentCommit).not.toBe(m0);
    const mainNow = git(['rev-parse', 'main']);
    expect(mainNow).toBe(m0);
  }, 120000);

  test('DELETE-02 branch apagada e proveniência NÃO prova o commit ⇒ MISSION_SOURCE_RECOVERY_REQUIRED', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const m0 = git(['rev-parse', 'main']);
    const missionId = await createMissionRow();
    const branch = branchFor(missionId);
    git(['branch', branch, m0]);

    const m2 = createCommit({ baseCommit: m0, message: 'M2' });
    const m3 = createCommit({ baseCommit: m2, message: 'M3' });
    const stranger = createCommit({ baseCommit: m2, message: 'M-NOT-AUTHORIZED' });

    // O DB diz M3, mas o único receipt registrado aponta para OUTRO commit: não se inventa source.
    await setSource(missionId, {
      mission_source_ref: 'main', mission_base_commit: m0, mission_integration_branch: branch,
      mission_current_commit: m3, mission_source_state: 'READY', mission_source_fence: 2,
    });
    await createIntegratedReceipt({ missionId, candidateCommit: stranger, missionCommitBefore: m2, missionCommitAfter: stranger });

    git(['branch', '-D', branch]);

    await expect(missionSourceService.ensureMissionSource(missionId, { actor: 'jest-lifecycle' }))
      .rejects.toMatchObject({ code: 'MISSION_SOURCE_RECOVERY_REQUIRED' });

    const mission = await readMission(missionId);
    expect(mission.mission_source_state).toBe('RECOVERY_REQUIRED');
    // Nada foi criado: nem a branch no commit corrente, nem na main.
    expect(gitSafe(['rev-parse', '--verify', `refs/heads/${branch}`]).ok).toBe(false);
  }, 120000);
});

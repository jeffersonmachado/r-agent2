'use strict';

/**
 * tests/integration/missionSourceCrashWindowE2E.test.js
 *
 * JANELA CRÍTICA DE CRASH DA FONTE DA MISSÃO — prova com PROCESSO REAL.
 *
 * O QUE É PROVADO (e por que só um processo real prova): entre `git update-ref` (o efeito no git) e
 * o CAS no banco existe uma janela em que a branch está À FRENTE do registro. Se o processo morrer
 * exatamente aí, é preciso que (a) a branch tenha andado, (b) o banco NÃO tenha andado, (c) o
 * intent diga a verdade sobre isso (`GIT_APPLIED`) e (d) uma reconciliação automática, em OUTRO
 * processo, CURE o estado sem intervenção humana — sem "adotar branch não explicada" e sem repetir
 * o efeito no git.
 *
 * Simular a janela com um mock não prova nada: o valor está justamente em o processo MORRER de
 * verdade entre as duas operações. Por isso o serviço tem um failpoint
 * (`ENGINEERING_MISSION_FAILPOINT=after_git_update_ref_before_db_cas`) e por isso o teste dispara um
 * FILHO de verdade e confere o código de saída 97.
 *
 * DEFEITO QUE ESTE TESTE TRAVA: o failpoint foi escrito com este propósito (o comentário no serviço
 * diz "existe para o E2E matar o processo exatamente na janela crítica") e NENHUM teste o exercitava
 * — mecanismo sem prova. Antes dele, `git update-ref` era um efeito sem causa auditável.
 *
 * Infra ausente (git/Postgres) ⇒ pulo EXPLÍCITO via `skipOrFail`; com RELEASE_AUTHORITATIVE=1 a
 * ausência vira INFRA_ERROR — nunca PASS silencioso.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

// O repositório de teste precisa existir ANTES do require dos serviços (eles resolvem ROOT no
// carregamento). Sem isto o teste operaria sobre o repositório REAL do projeto.
const REPO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-crash-e2e-'));
const WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-crash-ws-'));
process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = REPO_DIR;
process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = WORKSPACE_DIR;

const { skipOrFail } = require('../helpers/infraGate');
const sequelizeModule = require('../../api/db/sequelize');
const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');

const SUITE_NAME = 'mission-source-crash-window-e2e';
const API_ROOT = path.resolve(__dirname, '../..');

const FAILPOINT_NAME = 'after_git_update_ref_before_db_cas';

let skipReason = null;
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
    if (models.EngineeringTask && created.tasks.length > 0) {
      await models.EngineeringTask().destroy({ where: { id: created.tasks } });
    }
    if (models.EngineeringMission && created.missions.length > 0) {
      await models.EngineeringMission().destroy({ where: { id: created.missions } });
    }
  } catch (err) {
    // limpeza best-effort: não pode mascarar o veredito do teste
  }
  for (const dir of [REPO_DIR, WORKSPACE_DIR]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // idem
    }
  }
});

/** Candidato REAL: filho direto do commit da fonte (integração = fast-forward). */
function createCandidate({ baseCommit, message }) {
  const ws = fs.mkdtempSync(path.join(WORKSPACE_DIR, 'cand-'));
  git(['worktree', 'add', '--detach', ws, baseCommit]);
  try {
    fs.writeFileSync(path.join(ws, 'fix.txt'), `${message}\n`);
    git(['add', '-A'], { cwd: ws });
    const tree = git(['write-tree'], { cwd: ws });
    return git(['commit-tree', tree, '-p', baseCommit, '-m', message]);
  } finally {
    gitSafe(['worktree', 'remove', '--force', ws]);
  }
}

async function createMissionAtCommit(commit) {  const { EngineeringMission } = require('../../api/db/models');
  const Mission = EngineeringMission();
  const row = await Mission.create({
    title: `E2E janela de crash ${Date.now()}`,
    original_mission: 'Provar que a janela entre o update-ref e o CAS é recuperável.',
    original_mission_hash: `crash-e2e-${Date.now()}`,
    mission_type: 'INVESTIGATION',
    risk: 'LOW',
    scope: 'LOW',
    status: 'EXECUTING',
    branch: 'main',
  });
  created.missions.push(row.id);
  await Mission.update(
    { mission_current_commit: commit, mission_source_fence: 0 },
    { where: { id: row.id } },
  );
  return row.id;
}

/**
 * A task é OBRIGATÓRIA: a chave de idempotência da integração é derivada de
 * `(missionId, taskId, candidateCommit)` — um intent sem task não tem identidade e é recusado.
 */
async function createTaskRow({ missionId, sourceCommit, title }) {
  const task = await engineeringTaskService.createTask({
    title,
    objective: title,
    taskType: 'IMPLEMENT',
    risk: 'LOW',
    scope: 'LOW',
    missionId,
    sourceCommit,
    sourceRef: 'main',
    sourceMissionFence: 0,
  }, { createdBy: 'jest-mission-crash-e2e', idempotencyKey: `crash-e2e:${missionId}:${title}` });
  created.tasks.push(task.id);
  return task;
}

async function readMissionSource(missionId) {  const { EngineeringMission } = require('../../api/db/models');
  const row = await EngineeringMission().findByPk(missionId);
  const plain = row.get ? row.get({ plain: true }) : row;
  return {
    currentCommit: plain.mission_current_commit,
    fence: plain.mission_source_fence,
  };
}

async function readIntent(intentId) {
  const { EngineeringMissionIntegration } = require('../../api/db/models');
  const row = await EngineeringMissionIntegration().findByPk(intentId);
  const plain = row.get ? row.get({ plain: true }) : row;
  return {
    status: plain.integration_status,
    result: plain.integration_result,
    missionCommitAfter: plain.mission_commit_after,
    gitAppliedAt: plain.git_applied_at,
    dbAppliedAt: plain.db_applied_at,
  };
}

/** Escreve o processo FILHO que morre na janela crítica. */
function writeCrashChild() {
  const file = path.join(WORKSPACE_DIR, `crash-child-${Date.now()}.js`);
  fs.writeFileSync(file, `'use strict';
const sequelizeModule = require(${JSON.stringify(path.join(API_ROOT, 'api/db/sequelize'))});
const service = require(${JSON.stringify(path.join(API_ROOT, 'api/services/engineeringMission/missionSourceService'))});
(async () => {
  await sequelizeModule.connect(2, 250);
  const result = await service.advanceMissionSource({
    missionId: process.env.CRASH_MISSION_ID,
    expectedCommit: process.env.CRASH_EXPECTED,
    newCommit: process.env.CRASH_NEW,
    expectedFence: 0,
    branch: process.env.CRASH_BRANCH,
    intentId: process.env.CRASH_INTENT_ID,
  });
  // Chegar aqui significa que o failpoint NÃO disparou: a prova seria vacuosa.
  process.stdout.write(JSON.stringify({ advanced: result && result.advanced, code: (result && result.code) || null }));
  process.exit(0);
})().catch((err) => {
  process.stderr.write('CHILD_ERROR ' + err.message);
  process.exit(3);
});
`);
  return file;
}

describe('janela crítica entre o update-ref e o CAS do banco', () => {
  test('CRASH_01 processo morto na janela deixa git à frente e o intent dizendo GIT_APPLIED', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionAtCommit(base);
    const branch = `mission/${missionId.slice(0, 8)}`;
    git(['branch', branch, base]);
    const candidate = createCandidate({ baseCommit: base, message: 'fix do candidate' });
    const task = await createTaskRow({ missionId, sourceCommit: base, title: 'CRASH_01' });

    const prepared = await missionSourceService.prepareIntegrationIntent({
      missionId,
      taskId: task.id,
      candidateCommit: candidate,
      candidateBaseCommit: base,
      expectedMissionCommit: base,
      expectedFence: 0,
      integrationBranch: branch,
      workerInstanceId: 'jest-crash-e2e',
    });
    const intentId = prepared.intent.id;
    expect(prepared.intent.integration_status).toBe('PREPARED');

    // ---- O CRASH: processo REAL morre entre o update-ref e o CAS ----
    const child = writeCrashChild();
    const run = spawnSync(process.execPath, [child], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENGINEERING_ROUTER_HOST_REPO_ROOT: REPO_DIR,
        ENGINEERING_ROUTER_WORKSPACE_ROOT: WORKSPACE_DIR,
        ENGINEERING_MISSION_FAILPOINT: FAILPOINT_NAME,
        CRASH_MISSION_ID: missionId,
        CRASH_EXPECTED: base,
        CRASH_NEW: candidate,
        CRASH_BRANCH: branch,
        CRASH_INTENT_ID: intentId,
      },
    });

    // A morte tem de ser EXATAMENTE a do failpoint (97), não um erro qualquer do script: um
    // exit 3 (CHILD_ERROR) provaria outra coisa e não a janela.
    expect(run.stderr || '').not.toMatch(/CHILD_ERROR/);
    expect(run.status).toBe(97);

    // (a) o git ANDOU
    expect(git(['rev-parse', branch])).toBe(candidate);
    // (b) o banco NÃO andou
    const afterCrash = await readMissionSource(missionId);
    expect(afterCrash.currentCommit).toBe(base);
    // (c) o intent conta a verdade: efeito no git aplicado, banco não
    const intentAfterCrash = await readIntent(intentId);
    expect(intentAfterCrash.status).toBe('GIT_APPLIED');
    expect(intentAfterCrash.dbAppliedAt).toBeFalsy();
  }, 120000);

  test('CRASH_02 reconciliação em OUTRO processo CURA o estado sem repetir o git', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionAtCommit(base);
    const branch = `mission/${missionId.slice(0, 8)}`;
    git(['branch', branch, base]);
    const candidate = createCandidate({ baseCommit: base, message: 'fix recuperável' });
    const task = await createTaskRow({ missionId, sourceCommit: base, title: 'CRASH_02' });

    const prepared = await missionSourceService.prepareIntegrationIntent({
      missionId,
      taskId: task.id,
      candidateCommit: candidate,
      candidateBaseCommit: base,
      expectedMissionCommit: base,
      expectedFence: 0,
      integrationBranch: branch,
      workerInstanceId: 'jest-crash-e2e',
    });
    const intentId = prepared.intent.id;

    const child = writeCrashChild();
    const run = spawnSync(process.execPath, [child], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENGINEERING_ROUTER_HOST_REPO_ROOT: REPO_DIR,
        ENGINEERING_ROUTER_WORKSPACE_ROOT: WORKSPACE_DIR,
        ENGINEERING_MISSION_FAILPOINT: FAILPOINT_NAME,
        CRASH_MISSION_ID: missionId,
        CRASH_EXPECTED: base,
        CRASH_NEW: candidate,
        CRASH_BRANCH: branch,
        CRASH_INTENT_ID: intentId,
      },
    });
    expect(run.status).toBe(97);
    expect(git(['rev-parse', branch])).toBe(candidate);

    // ---- RECUPERAÇÃO: outro processo varre os intents não-terminais ----
    const reconciled = await missionSourceService.reconcileMissionSourceIntents({ missionId });
    // O retorno real é `{ reconciled, outcomes }` — a varredura precisa ter visto o intent.
    expect(Array.isArray(reconciled.outcomes)).toBe(true);
    expect(reconciled.outcomes.length).toBeGreaterThanOrEqual(1);

    // O estado converge: banco alcança o git SEM um segundo update-ref (o efeito já estava feito).
    const healed = await readMissionSource(missionId);
    expect(healed.currentCommit).toBe(candidate);

    const intentHealed = await readIntent(intentId);
    expect(intentHealed.dbAppliedAt).toBeTruthy();
    expect(['DB_APPLIED', 'COMMITTED']).toContain(intentHealed.status);

    // A branch continua exatamente onde o crash deixou — nenhuma reaplicação, nenhuma divergência.
    expect(git(['rev-parse', branch])).toBe(candidate);
  }, 120000);

  test('CRASH_03 idempotência: reconciliar de novo não muda nada nem duplica efeito', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const base = git(['rev-parse', 'main']);
    const missionId = await createMissionAtCommit(base);
    const branch = `mission/${missionId.slice(0, 8)}`;
    git(['branch', branch, base]);
    const candidate = createCandidate({ baseCommit: base, message: 'fix idempotente' });
    const task = await createTaskRow({ missionId, sourceCommit: base, title: 'CRASH_03' });

    const prepared = await missionSourceService.prepareIntegrationIntent({
      missionId,
      taskId: task.id,
      candidateCommit: candidate,
      candidateBaseCommit: base,
      expectedMissionCommit: base,
      expectedFence: 0,
      integrationBranch: branch,
      workerInstanceId: 'jest-crash-e2e',
    });

    const child = writeCrashChild();
    const run = spawnSync(process.execPath, [child], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENGINEERING_ROUTER_HOST_REPO_ROOT: REPO_DIR,
        ENGINEERING_ROUTER_WORKSPACE_ROOT: WORKSPACE_DIR,
        ENGINEERING_MISSION_FAILPOINT: FAILPOINT_NAME,
        CRASH_MISSION_ID: missionId,
        CRASH_EXPECTED: base,
        CRASH_NEW: candidate,
        CRASH_BRANCH: branch,
        CRASH_INTENT_ID: prepared.intent.id,
      },
    });
    expect(run.status).toBe(97);

    await missionSourceService.reconcileMissionSourceIntents({ missionId });
    const first = await readIntent(prepared.intent.id);

    // Segunda varredura: o intent já é terminal, então nada é reaplicado.
    await missionSourceService.reconcileMissionSourceIntents({ missionId });
    const second = await readIntent(prepared.intent.id);

    expect(second.status).toBe(first.status);
    expect(second.dbAppliedAt).toEqual(first.dbAppliedAt);
    expect(git(['rev-parse', branch])).toBe(candidate);
    const source = await readMissionSource(missionId);
    expect(source.currentCommit).toBe(candidate);
  }, 120000);
});

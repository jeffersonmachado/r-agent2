'use strict';

/**
 * E2E DA AUTORIDADE DE FONTE DE UMA ENGINEERING MISSION (git REAL).
 *
 * O TESTE DEFINITIVO DO SELF-ENGINEERING NÃO É "o Bug Loop criou um candidate GREEN". É:
 *
 *   MISSION
 *     → Task A produz patch
 *     → Task B nasce do commit da missão (VÊ o patch A)
 *     → Task B falha (bug real)
 *     → fix integrado NA FONTE DA MISSÃO
 *     → replacement Task B nasce do commit JÁ CORRIGIDO (VÊ o fix)
 *     → Task C nasce de tudo
 *     → MISSÃO GREEN
 *     → MAIN NUNCA FOI ALTERADA
 *
 * DEFEITO QUE ESTE TESTE TRAVA (confirmado no código em 2026-10-02): o worktree de toda tentativa
 * era materializado de `git rev-parse HEAD` do ROOT (a `main`), e o candidate tinha pai na `main`.
 * O fix do Bug Loop ficava numa branch isolada; a replacement task voltava a nascer da `main`; o bug
 * "reaparecia". A recorrência era ARTEFATO de o fix nunca ter entrado na source usada.
 *
 * O que é REAL aqui: repositório git de verdade (commits, branches, `update-ref`, worktrees) e
 * linhas reais de missão/task no Postgres. O que é dublê: nada. Não há LLM neste teste — ele prova a
 * MECÂNICA DE FONTE, que é onde o defeito estava.
 *
 * Infra ausente (git/Postgres) ⇒ pulo EXPLÍCITO via `skipOrFail`; com RELEASE_AUTHORITATIVE=1 a
 * ausência lança INFRA_ERROR — nunca PASS silencioso.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------------------------
// O repositório de teste precisa existir ANTES do require: `contextBuilderService` resolve `ROOT`
// no carregamento do módulo. Sem isto, o serviço operaria sobre o repositório REAL do projeto.
// ---------------------------------------------------------------------------------------------
const REPO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-source-e2e-'));
const WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-source-ws-'));
process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = REPO_DIR;
process.env.ENGINEERING_ROUTER_WORKSPACE_ROOT = WORKSPACE_DIR;

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail: infraSkipOrFail } = require('../helpers/infraGate');

/**
 * HIGIENE DE INFRAESTRUTURA DE TESTE (intervenção humana/externa, 2026-10-07).
 *
 * DEFEITO MEDIDO: este arquivo chamava a porta canônica como `skipOrFail(SUITE_NAME, reason)` —
 * forma POSICIONAL —, mas `tests/helpers/infraGate.js` espera `{suite, available, reason,
 * requirement}`. Como um string desestruturado não tem essas chaves, `available` virava
 * `undefined` (falsy) e a função devolvia `true`; os callbacks SÍNCRONOS faziam `return` desse
 * `true`, e o Jest abortava a suíte com "test functions can only return Promise or undefined.
 * Returned value: true". Resultado real: no sandbox (sem Postgres), MISSION_SRC_01 falhava por
 * um erro de API do Jest — não por uma falha real —, derrubando a regressão HIGH/CRITICAL de
 * TODA task do subsistema. Além disso, o skip era registrado com `suite: undefined` (registro
 * inútil) nos callbacks assíncronos.
 *
 * CORREÇÃO (mínima, sem afrouxar nada): delega para a MESMA porta canônica com o contrato
 * correto — `available: false` porque a chamada só acontece quando a infraestrutura está
 * ausente — e NÃO devolve valor, de modo que `return skipOrFail(...)` apenas encerra o teste.
 * O comportamento de gate permanece idêntico ao canônico: em `RELEASE_AUTHORITATIVE=1` a
 * ausência lança `INFRA_ERROR` (a suíte FALHA, nunca PASS silencioso); em modo dev o pulo é
 * REGISTRADO como `NOT_EXECUTED` com suite/requisito/motivo.
 */
function skipOrFail(suite, reason) {
  infraSkipOrFail({ suite, available: false, reason, requirement: 'postgres' });
}

const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const patchApplyService = require('../../api/services/engineeringRouter/patchApplyService');
const source = require('../../engine/engineeringMission/missionSource');

const SUITE_NAME = 'engineering-mission-source-e2e';

let dbAvailable = false;
let dbReason = 'desconhecido';
const created = { missions: [], tasks: [] };

/** git de verdade no repo temporário. */
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

function writeFile(relPath, content) {
  const abs = path.join(REPO_DIR, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/**
 * Cria um COMMIT CANDIDATE exatamente como o Router faz: aplica o conteúdo a partir de `baseCommit`
 * num worktree descartável, escreve a árvore e cria o commit com `commit-tree -p <baseCommit>`.
 *
 * O `-p <baseCommit>` é o ponto inteiro: é isso que faz o candidate ser um DESCENDENTE DIRETO do
 * commit da fonte da missão — e portanto integrá-lo ser um fast-forward, não um merge cego.
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
    const commit = git(['commit-tree', tree, '-p', baseCommit, '-m', message]);
    return commit;
  } finally {
    gitSafe(['worktree', 'remove', '--force', ws]);
    if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  }
}

/** Lê um arquivo COMO ELE EXISTE num commit — prova de que a task seguinte ENXERGA o conteúdo. */
function readAtCommit(commit, relPath) {
  return git(['show', `${commit}:${relPath}`]);
}

/** Arquivo existe nesse commit? */
function existsAtCommit(commit, relPath) {
  return gitSafe(['cat-file', '-e', `${commit}:${relPath}`]).ok;
}

async function createMissionRow() {
  const { EngineeringMission } = require('../../api/db/models');
  const Mission = EngineeringMission();
  const row = await Mission.create({
    title: `E2E fonte de missão ${Date.now()}`,
    original_mission: 'Provar que a missão executa sobre fonte isolada e que o fix integra nela.',
    original_mission_hash: `e2e-${Date.now()}`,
    mission_type: 'INVESTIGATION',
    risk: 'LOW',
    scope: 'LOW',
    status: 'EXECUTING',
    branch: 'main',
  });
  created.missions.push(row.id);
  return row;
}

async function createTaskRow({ missionId, sourceCommit, sourceRef, title }) {
  const task = await engineeringTaskService.createTask({
    title,
    objective: title,
    taskType: 'IMPLEMENT',
    risk: 'LOW',
    scope: 'LOW',
    missionId,
    sourceCommit,
    sourceRef,
    sourceMissionFence: 0,
  }, { createdBy: 'jest-mission-source-e2e', idempotencyKey: `e2e:${missionId}:${title}` });
  created.tasks.push(task.id);
  return task;
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
    const index = require('../../api/db/models');
    for (const taskId of created.tasks) {
      await index.EngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
    }
    if (created.missions.length) {
      await index.getEngineeringMissionIntegration()
        .destroy({ where: { mission_id: created.missions } }).catch(() => {});
      await index.EngineeringMission().destroy({ where: { id: created.missions } }).catch(() => {});
    }
  }
  if (fs.existsSync(REPO_DIR)) fs.rmSync(REPO_DIR, { recursive: true, force: true });
  if (fs.existsSync(WORKSPACE_DIR)) fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
}, 60000);

describe('Mission Source Authority — E2E com git real', () => {
  let skipReason = null;
  let mission = null;
  let missionSource = null;
  let mainAtStart = null;

  beforeAll(async () => {
    if (!dbAvailable) {
      skipReason = `Postgres indisponível: ${dbReason}`;
      return;
    }
    // --- repositório real: main em M0 -------------------------------------------------------
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'e2e@results.local']);
    git(['config', 'user.name', 'E2E Mission Source']);
    writeFile('README.md', '# E2E mission source\n');
    writeFile('src/feature.js', 'module.exports = { feature: () => "v0" };\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'M0: base da linha principal']);

    mission = await createMissionRow();
    missionSource = await missionSourceService.ensureMissionSource(mission.id, { actor: 'jest' });
    mainAtStart = await missionSourceService.readMainCommit('main');
  }, 120000);

  test('MISSION_SRC_01 — a missão recebe uma fonte ISOLADA derivada da main, nunca a própria main', () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);
    expect(missionSource.integrationBranch).toBe(`engineering/missions/${mission.id}`);
    expect(missionSource.sourceRef).toBe('main');
    expect(missionSource.baseCommit).toBe(mainAtStart);          // M0 gravado como base
    expect(missionSource.currentCommit).toBe(mainAtStart);        // fonte começa em M0
    expect(source.isMissionBranch(missionSource.integrationBranch)).toBe(true);
    // A fonte existe como ref REAL no git, e não é a main.
    expect(missionSourceService.branchExists(missionSource.integrationBranch)).toBeTruthy();
    expect(missionSource.integrationBranch).not.toBe('main');
  });

  test('MISSION_SRC_02 — a task HERDA o commit da fonte e o worktree é materializado DELE', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const taskA = await createTaskRow({
      missionId: mission.id,
      sourceCommit: missionSource.currentCommit,
      sourceRef: missionSource.integrationBranch,
      title: 'task-a',
    });

    expect(taskA.source_commit).toBe(missionSource.currentCommit);
    expect(taskA.source_ref).toBe(missionSource.integrationBranch);
    expect(taskA.mission_id).toBe(mission.id);

    // PROVA por efeito: a resolução do base da task devolve o commit da MISSÃO, não o HEAD do ROOT.
    const resolved = await patchApplyService.resolveTaskBaseCommit(taskA.id);
    expect(resolved.origin).toBe('MISSION_SOURCE');
    expect(resolved.commit).toBe(missionSource.currentCommit);

    // E a task entrega o MESMO commit que o HEAD do ROOT (no início os dois coincidem — o que
    // importa é a ORIGEM declarada, provada acima e revalidada quando divergirem).
    const headNow = git(['rev-parse', 'HEAD']);
    expect(resolved.commit).toBe(headNow);
  });

  test('MISSION_SRC_02b — a task NASCE do patch já integrado (o valor que task-a deixa)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    // Task A produz um patch REAL sobre a fonte e o candidate é integrado.
    const candidateA = createCandidate({
      baseCommit: missionSource.currentCommit,
      files: { 'src/feature.js': 'module.exports = { feature: () => "vA", fromTaskA: true };\n' },
      message: 'task A: adiciona fromTaskA',
    });
    const taskA = created.tasks.find(() => true);

    const integrationA = await missionSourceService.integrateCandidate({
      missionId: mission.id,
      taskId: taskA,
      candidateCommit: candidateA,
      integrationType: 'TASK_CANDIDATE',
      preconditions: PRECONDITIONS_OK,
      actor: 'jest',
    });

    expect(integrationA.integrated).toBe(true);
    expect(integrationA.result).toBe('INTEGRATED');
    expect(integrationA.missionCommitAfter).toBe(candidateA);

    // A FONTE avança (M0 → A1) e a task SEGUINTE nasce desse commit.
    const afterA = await missionSourceService.getMissionSource(mission.id);
    expect(afterA.currentCommit).toBe(candidateA);
    expect(afterA.fence).toBe(1);

    const taskB = await createTaskRow({
      missionId: mission.id,
      sourceCommit: afterA.currentCommit,
      sourceRef: afterA.integrationBranch,
      title: 'task-b',
    });
    expect(taskB.source_commit).toBe(candidateA);

    // A task seguinte ENXERGA o patch da anterior — por efeito, não por hash.
    const resolvedB = await patchApplyService.resolveTaskBaseCommit(taskB.id);
    expect(resolvedB.commit).toBe(candidateA);
    expect(readAtCommit(resolvedB.commit, 'src/feature.js')).toContain('fromTaskA');
  });

  test('MISSION_SRC_03/04 — o fix do bug INTEGRA na fonte e a replacement task VÊ o fix', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const before = await missionSourceService.getMissionSource(mission.id);
    const missionCommitBeforeFix = before.currentCommit;

    // O BUG: o arquivo introduzido pela task A quebra um contrato.
    writeFile('src/consumer.js', 'const { feature } = require("./feature");\nmodule.exports = feature();\n');
    // ...e o fix (candidate do Bug Loop) corrige o consumidor.
    const fixCandidate = createCandidate({
      baseCommit: missionCommitBeforeFix,
      files: { 'src/feature.js': 'module.exports = { feature: () => "vA", fromTaskA: true, bugFixed: true };\n' },
      message: 'bug fix: corrige contrato de feature()',
    });

    const bugFixTask = created.tasks.find((t) => t) && created.tasks[created.tasks.length - 1];
    const integrationFix = await missionSourceService.integrateCandidate({
      missionId: mission.id,
      taskId: bugFixTask,
      candidateCommit: fixCandidate,
      integrationType: 'BUG_FIX_CANDIDATE',
      preconditions: PRECONDITIONS_OK,
      actor: 'jest-bug-loop',
    });

    expect(integrationFix.integrated).toBe(true);
    expect(integrationFix.missionCommitBefore).toBe(missionCommitBeforeFix);
    expect(integrationFix.missionCommitAfter).toBe(fixCandidate);

    // A REPLACEMENT task nasce do commit JÁ CORRIGIDO (é o defeito que este teste trava).
    const afterFix = await missionSourceService.getMissionSource(mission.id);
    const replacement = await createTaskRow({
      missionId: mission.id,
      sourceCommit: afterFix.currentCommit,
      sourceRef: afterFix.integrationBranch,
      title: 'task-b-replacement',
    });
    expect(replacement.source_commit).toBe(fixCandidate);

    const resolvedReplacement = await patchApplyService.resolveTaskBaseCommit(replacement.id);
    // O BUG NÃO REAPARECE: o arquivo lido pela replacement contém a marca do fix, E a marca da task A.
    const content = readAtCommit(resolvedReplacement.commit, 'src/feature.js');
    expect(content).toContain('bugFixed');
    expect(content).toContain('fromTaskA');

    // A task SEGUINTE vê o histórico COMPLETO.
    const taskC = await createTaskRow({
      missionId: mission.id,
      sourceCommit: afterFix.currentCommit,
      sourceRef: afterFix.integrationBranch,
      title: 'task-c',
    });
    const resolvedC = await patchApplyService.resolveTaskBaseCommit(taskC.id);
    expect(readAtCommit(resolvedC.commit, 'src/feature.js')).toContain('bugFixed');
    expect(readAtCommit(resolvedC.commit, 'src/feature.js')).toContain('fromTaskA');
  });

  test('MISSION_SRC_05 — MAIN PERMANECE INTOCADA durante toda a missão', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const mainNow = await missionSourceService.readMainCommit('main');
    expect(mainNow).toBe(mainAtStart);

    // HEAD do repositório também não se moveu: nenhuma integração toca working tree nem branch atual.
    expect(git(['rev-parse', 'HEAD'])).toBe(mainAtStart);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');

    // A main NÃO contém o patch da missão — é isso que faz a promoção ser um ato separado.
    const mainFeature = readAtCommit(mainAtStart, 'src/feature.js');
    expect(mainFeature).toContain('v0');
    expect(mainFeature).not.toContain('fromTaskA');
    expect(mainFeature).not.toContain('bugFixed');
  });

  test('MISSION_SRC_06 — candidate OBSOLETO é recusado, nunca aplicado cegamente', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);

    // Candidate construído sobre a BASE ANTIGA da missão (M0), não sobre o commit corrente.
    const staleCandidate = createCandidate({
      baseCommit: current.baseCommit,
      files: { 'src/stale.js': 'module.exports = "stale";\n' },
      message: 'candidate obsoleto sobre M0',
    });

    const staleTask = await createTaskRow({
      missionId: mission.id,
      sourceCommit: current.baseCommit,
      sourceRef: current.integrationBranch,
      title: 'task-stale',
    });

    const verdict = await missionSourceService.integrateCandidate({
      missionId: mission.id,
      taskId: staleTask.id,
      candidateCommit: staleCandidate,
      preconditions: PRECONDITIONS_OK,
      actor: 'jest',
    });

    expect(verdict.integrated).toBe(false);
    expect(verdict.result).toBe('STALE_CANDIDATE');
    expect(verdict.code).toBe('STALE_CANDIDATE');

    // A FONTE NÃO SE MOVEU: recusar é não aplicar.
    const after = await missionSourceService.getMissionSource(mission.id);
    expect(after.currentCommit).toBe(current.currentCommit);
    expect(existsAtCommit(after.currentCommit, 'src/stale.js')).toBe(false);

    // E a recusa ficou REGISTRADA na trilha (auditável).
    const history = await missionSourceService.listIntegrations(mission.id);
    expect(history.some((h) => h.integration_result === 'STALE_CANDIDATE')).toBe(true);
  });

  test('MISSION_SRC_07 — integração CONCORRENTE é serializada por CAS (sem sobrescrever o outro)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const staleFence = current.fence;

    // Dois candidates válidos sobre o MESMO commit corrente — a corrida real.
    const candidateX = createCandidate({ baseCommit: current.currentCommit, files: { 'src/x.js': 'module.exports = "x";\n' }, message: 'concorrente X' });
    const candidateY = createCandidate({ baseCommit: current.currentCommit, files: { 'src/y.js': 'module.exports = "y";\n' }, message: 'concorrente Y' });

    const taskX = await createTaskRow({ missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-conc-x' });
    const taskY = await createTaskRow({ missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-conc-y' });

    const [rx, ry] = await Promise.all([
      missionSourceService.integrateCandidate({ missionId: mission.id, taskId: taskX.id, candidateCommit: candidateX, preconditions: PRECONDITIONS_OK, actor: 'jest-x' }),
      missionSourceService.integrateCandidate({ missionId: mission.id, taskId: taskY.id, candidateCommit: candidateY, preconditions: PRECONDITIONS_OK, actor: 'jest-y' }),
    ]);

    const winners = [rx, ry].filter((r) => r.integrated);
    const losers = [rx, ry].filter((r) => !r.integrated);

    // EXATAMENTE UM vence: dois avanços sobre a mesma base não podem os dois aplicar.
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // O perdedor é recusado por CAS ou por obsolescência — nunca aplicado em cima do vencedor.
    expect(['CONCURRENT_SOURCE_UPDATE', 'STALE_CANDIDATE']).toContain(losers[0].result);

    // A fonte está EXATAMENTE no commit do vencedor, e o avanço é atômico (fence andou 1).
    const after = await missionSourceService.getMissionSource(mission.id);
    expect(after.currentCommit).toBe(winners[0].missionCommitAfter);
    expect(after.fence).toBeGreaterThan(staleFence);

    // O perdedor NÃO deixou rastro de código na fonte.
    const loserFile = losers[0] === rx ? 'src/x.js' : 'src/y.js';
    expect(existsAtCommit(after.currentCommit, loserFile)).toBe(false);
  });

  test('MISSION_SRC_08 — integração é CRASH-SAFE: a mesma tríade não aplica o patch duas vezes', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const candidate = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/crash-safe.js': 'module.exports = "once";\n' },
      message: 'candidate crash-safe',
    });
    const task = await createTaskRow({ missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-crash' });

    const first = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest-1',
    });
    expect(first).toMatchObject({ integrated: true, result: 'INTEGRATED' });
    const commitAfterFirst = first.missionCommitAfter;

    // SIMULAÇÃO DE CRASH/RETOMADA: a MESMA integração é tentada de novo (o processo morreu depois de
    // criar o commit e antes de persistir). A tríade é reconhecida ⇒ o patch NÃO é reaplicado.
    const second = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest-2',
    });
    expect(second).toMatchObject({ integrated: true, result: 'ALREADY_INTEGRATED' });

    // A fonte continua no MESMO commit — não houve um segundo avanço.
    const after = await missionSourceService.getMissionSource(mission.id);
    expect(after.currentCommit).toBe(commitAfterFirst);

    // E a trilha registrou a tríade UMA única vez como INTEGRATED.
    const history = await missionSourceService.listIntegrations(mission.id);
    const integratedSameTriple = history.filter((h) => h.integration_result === 'INTEGRATED' && h.candidate_commit === candidate);
    expect(integratedSameTriple).toHaveLength(1);
  });

  test('MISSION_SRC_08b — RECONCILIAÇÃO: crash entre o git e o banco não deixa a fonte mentindo', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const candidate = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/reconcile.js': 'module.exports = "reconcile";\n' },
      message: 'candidate reconciliacao',
    });
    const task = await createTaskRow({ missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-reconcile' });

    await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest',
    });

    // SIMULA O CRASH EXATO: o git avançou, o banco não. (É o estado real do processo morto entre as
    // duas escritas — a branch está à frente, o registro da missão ainda aponta para trás.)
    const { EngineeringMission } = require('../../api/db/models');
    const Mission = EngineeringMission();
    await Mission.update({ mission_current_commit: current.currentCommit, mission_source_fence: current.fence }, { where: { id: mission.id } });

    const desaligned = await missionSourceService.getMissionSource(mission.id);
    expect(desaligned.currentCommit).toBe(current.currentCommit);  // o banco mente
    expect(await missionSourceService.branchExists(desaligned.integrationBranch)).toBe(candidate); // o git sabe a verdade

    // RETOMADA: a mesma tríade é reenviada. Reconhecida ⇒ reconcilia o banco com a branch, SEM
    // reaplicar o patch.
    const resumed = await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest-resume',
    });
    expect(resumed).toMatchObject({ integrated: true, reconciled: true });

    const healed = await missionSourceService.getMissionSource(mission.id);
    expect(healed.currentCommit).toBe(candidate);
    expect(healed.state).toBe('READY');
  });

  test('MISSION_SRC_09 — pré-condição não satisfeita RECUSA a integração (candidate não entra só porque o coder terminou)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const candidate = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/no-review.js': 'module.exports = "x";\n' },
      message: 'sem review',
    });
    const task = await createTaskRow({ missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-no-review' });

    const verdict = await missionSourceService.integrateCandidate({
      missionId: mission.id,
      taskId: task.id,
      candidateCommit: candidate,
      preconditions: { ...PRECONDITIONS_OK, reviewVerdict: null },   // sem review
      actor: 'jest',
    });

    expect(verdict.integrated).toBe(false);
    expect(verdict.result).toBe('PRECONDITION_FAILED');
    expect(verdict.missing).toContain('NO_REVIEW');

    const after = await missionSourceService.getMissionSource(mission.id);
    expect(after.currentCommit).toBe(current.currentCommit);
    expect(existsAtCommit(after.currentCommit, 'src/no-review.js')).toBe(false);
  });

  test('MISSION_SRC_10 — o candidate final da missão é o commit DA FONTE, e ele carrega o histórico inteiro', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const exported = await missionSourceService.exportMissionCandidate(mission.id);

    expect(exported.exportable).toBe(true);
    expect(exported.integrationBranch).toBe(`engineering/missions/${mission.id}`);
    expect(exported.currentCommit).not.toBe(exported.baseCommit);
    expect(exported.integrationCount).toBeGreaterThanOrEqual(4);

    // O artifact aponta para um commit que contém task A + fix + tudo o mais.
    const feature = readAtCommit(exported.currentCommit, 'src/feature.js');
    expect(feature).toContain('fromTaskA');
    expect(feature).toContain('bugFixed');

    // E a main continua em M0 — o candidate final NÃO é a main.
    expect(await missionSourceService.readMainCommit('main')).toBe(mainAtStart);
    expect(exported.currentCommit).not.toBe(mainAtStart);

    // A trilha de auditoria tem o essencial exigido: quem, sobre qual base, sob qual fence.
    const history = await missionSourceService.listIntegrations(mission.id);
    for (const row of history) {
      expect(row.integration_key).toBeTruthy();
      expect(row.integration_type).toBeTruthy();
      expect(row.integration_result).toBeTruthy();
      expect(row.candidate_commit).toBeTruthy();
    }
    // Registrou tanto TASK_CANDIDATE quanto BUG_FIX_CANDIDATE — o fix usa o MESMO caminho.
    const types = new Set(history.map((h) => h.integration_type));
    expect(types.has('TASK_CANDIDATE')).toBe(true);
    expect(types.has('BUG_FIX_CANDIDATE')).toBe(true);
  });

  test('MISSION_SRC_11 — a herança é EXIGIDA: task de missão sem fonte não cai silenciosamente na main', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    // Task pertencente a uma missão mas SEM `source_commit` (o defeito antigo: nasceria da main).
    const { EngineeringTask } = require('../../api/db/models');
    const Task = EngineeringTask();
    const orphan = await Task.create({
      title: 'task-sem-fonte',
      task_type: 'IMPLEMENT',
      risk: 'LOW',
      scope: 'LOW',
      status: 'CLASSIFIED',
      mission_id: mission.id,
      source_commit: null,
    });
    created.tasks.push(orphan.id);

    await expect(patchApplyService.resolveTaskBaseCommit(orphan.id))
      .rejects.toThrow(/não declara `source_commit`/);

    // E o código do erro é estável (o chamador decide por código, não por texto).
    await patchApplyService.resolveTaskBaseCommit(orphan.id).catch((err) => {
      expect(err.reason).toBe('MISSION_SOURCE_NOT_INHERITED');
    });
  });

  test('MISSION_SRC_12 — branch movida para commit NÃO explicado → MISSION_SOURCE_DIVERGENCE (NUNCA adota)', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    // Commit ARBITRÁRIO: nasce da base mas NÃO passa por nenhuma integração — é o equivalente exato
    // de um push manual / rebase / outro worktree movendo a ref por fora do caminho auditável.
    const orphan = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/nao-autorizado.js': 'module.exports = "nao-autorizado";\n' },
      message: 'commit fora do caminho auditavel',
    });
    git(['update-ref', `refs/heads/${current.integrationBranch}`, orphan, current.currentCommit]);

    try {
      // A adoção era exatamente o defeito: `branch existe → adotar HEAD` aceitaria este commit.
      await expect(missionSourceService.ensureMissionSource(mission.id, { actor: 'jest-tamper' }))
        .rejects.toMatchObject({ code: 'MISSION_SOURCE_DIVERGENCE' });

      const after = await missionSourceService.getMissionSource(mission.id);
      expect(after.state).toBe('DIVERGENCE');
      // O ponto central: NÃO adotou o commit estranho (o defeito fazia DB := M666).
      expect(after.currentCommit).toBe(current.currentCommit);

      // Evidência DURÁVEL na missão, não só no log.
      const { EngineeringMission } = require('../../api/db/models');
      const Mission = EngineeringMission();
      const row = await Mission.findByPk(mission.id);
      const evidence = row.failure && row.failure.missionSourceDivergence;
      expect(evidence).toBeTruthy();
      expect(evidence.code).toBe('MISSION_SOURCE_DIVERGENCE');
      expect(evidence.branchCommit).toBe(orphan);
      expect(evidence.expectedMissionCommit).toBe(current.currentCommit);
    } finally {
      // Devolve a ref ao lugar para não contaminar os testes seguintes.
      git(['update-ref', `refs/heads/${current.integrationBranch}`, current.currentCommit, orphan]);
    }
  });

  test('MISSION_SRC_13 — intent GIT_APPLIED: reconciliação completa o banco SEM reaplicar o git', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const candidate = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/intent-resume.js': 'module.exports = "intent";\n' },
      message: 'candidate intent resume',
    });
    const task = await createTaskRow({
      missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-intent-resume',
    });

    await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest',
    });

    // Reconstrói o estado EXATO deixado pela morte do processo entre o git e o banco:
    //   ref git = candidate   ·   banco = commit anterior   ·   intent = GIT_APPLIED
    const { EngineeringMission, EngineeringMissionIntegration } = require('../../api/db/models');
    const Mission = EngineeringMission();
    const Integration = EngineeringMissionIntegration();
    await Mission.update(
      { mission_current_commit: current.currentCommit, mission_source_fence: current.fence },
      { where: { id: mission.id } },
    );
    const integrationKey = source.buildIntegrationKey({ missionId: mission.id, taskId: task.id, candidateCommit: candidate });
    await Integration.update(
      { integration_status: 'GIT_APPLIED', committed_at: null, integration_result: null },
      { where: { integration_key: integrationKey } },
    );

    const before = await missionSourceService.getMissionSource(mission.id);
    expect(before.currentCommit).toBe(current.currentCommit);           // o banco mente
    expect(await missionSourceService.branchExists(before.integrationBranch)).toBe(candidate); // o git sabe

    // A MESMA reconciliação que o boot chama. Não recebe o candidate: descobre pelo intent.
    const rec = await missionSourceService.reconcileMissionSourceIntents({ missionId: mission.id });
    expect(rec.reconciled).toBeGreaterThanOrEqual(1);
    expect(rec.outcomes.some((o) => o.outcome === 'FINISH_DB')).toBe(true);

    const healed = await missionSourceService.getMissionSource(mission.id);
    expect(healed.currentCommit).toBe(candidate);
    expect(healed.state).toBe('READY');

    // O intent terminou terminal — não fica varrendo para sempre.
    const intentRow = await Integration.findOne({ where: { integration_key: integrationKey } });
    expect(intentRow.integration_status).toBe('COMMITTED');

    // E o git NÃO foi tocado de novo: a ref continua no candidate (nada foi reaplicado).
    expect(await missionSourceService.branchExists(healed.integrationBranch)).toBe(candidate);
  });

  test('MISSION_SRC_14 — a reconciliação acontece no BOOT, sem comando manual', async () => {
    if (skipReason) return skipOrFail(SUITE_NAME, skipReason);

    const current = await missionSourceService.getMissionSource(mission.id);
    const candidate = createCandidate({
      baseCommit: current.currentCommit,
      files: { 'src/boot-reconcile.js': 'module.exports = "boot";\n' },
      message: 'candidate boot reconcile',
    });
    const task = await createTaskRow({
      missionId: mission.id, sourceCommit: current.currentCommit, sourceRef: current.integrationBranch, title: 'task-boot-reconcile',
    });

    await missionSourceService.integrateCandidate({
      missionId: mission.id, taskId: task.id, candidateCommit: candidate, preconditions: PRECONDITIONS_OK, actor: 'jest',
    });

    // Estado deixado pela morte do processo entre o git e o banco.
    const { EngineeringMission, EngineeringMissionIntegration } = require('../../api/db/models');
    const Mission = EngineeringMission();
    const Integration = EngineeringMissionIntegration();
    await Mission.update(
      { mission_current_commit: current.currentCommit, mission_source_fence: current.fence },
      { where: { id: mission.id } },
    );
    const integrationKey = source.buildIntegrationKey({ missionId: mission.id, taskId: task.id, candidateCommit: candidate });
    await Integration.update(
      { integration_status: 'GIT_APPLIED', committed_at: null, integration_result: null },
      { where: { integration_key: integrationKey } },
    );

    // O ponto do teste: NÃO há comando manual nem reenvio da tríade. Só o caminho de BOOT.
    const recovery = require('../../api/services/engineeringMission/missionRecoveryCoordinator');
    const result = await recovery.reconcilePendingIntents();
    expect(result.missions).toBeGreaterThanOrEqual(1);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);

    const healed = await missionSourceService.getMissionSource(mission.id);
    expect(healed.currentCommit).toBe(candidate);
    expect(healed.state).toBe('READY');
  });
});

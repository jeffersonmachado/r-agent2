'use strict';

/**
 * ERV1-CLOSE-004 / ER-V1-FINAL-006 — REGRESSION e GOVERNANCE precisam ser checagens reais,
 * capazes de reprovar, não transições de status decorativas.
 *
 * `checkRegression` (ER-V1-FINAL-006): achado real confirmado por inspeção direta do código
 * anterior — só chamava `listTestRuns(attemptId)`, relendo os `EngineeringTestRun` já
 * persistidos pela fase TESTING (evidence revalidation, nunca regression execution). Corrigido
 * para construir um `RegressionPlan` real proporcional ao risco e EXECUTAR os comandos de
 * verdade (via o sandbox real de ER-V1-FINAL-001) num workspace isolado, persistindo um
 * `EngineeringRegressionRun`. Testado aqui com workspace real (git worktree) e comandos reais.
 * `checkGovernance` executa de verdade o gate canônico existente
 * (scripts/governance/validate-engineering-router-v1.js) como subprocess real.
 */

const sequelizeModule = require('../../api/db/sequelize');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { createWorkspace, applyPatch, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
const { checkRegression, checkGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');

jest.setTimeout(90000);

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[regression-governance-service] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  const getModels = require('../../api/db/models');
  const Task = getModels.getEngineeringTask();
  const Attempt = getModels.getEngineeringAttempt();
  const TestRun = getModels.getEngineeringTestRun();
  try {
    for (const taskId of createdTaskIds) {
      const attempts = await Attempt.findAll({ where: { task_id: taskId } });
      for (const attempt of attempts) {
        await TestRun.destroy({ where: { attempt_id: attempt.id } });
      }
      await Attempt.destroy({ where: { task_id: taskId } });
      await Task.destroy({ where: { id: taskId } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
});

async function makeTaskAndAttempt({ testCommands, risk = 'LOW' }) {
  const task = await engineeringTaskService.createTask({
    title: 'regression-governance-fixture',
    objective: 'objetivo de teste',
    allowedPaths: ['tests/fixtures/engineering-router-sandbox/**'],
    testCommands,
    risk,
    maxIterations: 1,
  }, { createdBy: 'jest-regression-governance-test' });
  createdTaskIds.push(task.id);
  const attempt = await engineeringTaskService.createAttempt(task.id, { status: 'TESTED' });
  return { task, attempt };
}

describe('ER-V1-FINAL-006 — checkRegression executa de verdade (Postgres + workspace real, nunca só relê evidência antiga)', () => {
  const createdWorkspaces = [];

  afterEach(async () => {
    for (const ws of createdWorkspaces.splice(0)) {
      await destroyWorkspace(ws).catch(() => {});
    }
  });

  test('comandos do plano executam de verdade e passam → regressão aprova, com EngineeringRegressionRun persistido', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      touchedPaths: ['tests/fixtures/engineering-router-sandbox/mathUtils.js'],
      risk: 'LOW',
      targetedCommands: task.test_commands,
    });

    expect(result.pass).toBe(true);
    expect(result.evidence.planTier).toBe('LOW');
    expect(result.evidence.commandCount).toBe(1);
    expect(result.evidence.failed).toHaveLength(0);

    const runs = await engineeringTaskService.listRegressionRuns(attempt.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe('PASS');
    expect(runs[0].source_fingerprint).toEqual(expect.any(String));
  });

  test('comando do plano falha de verdade (exitCode != 0) → regressão reprova (nunca GREEN sem evidência real)', async () => {
    if (skipIfNoDatabase()) return;
    // jest sem nenhum arquivo correspondente ao padrão sai com exitCode != 0 de forma real e
    // determinística — prova execução de verdade (não existe nenhum EngineeringTestRun
    // anterior para este attempt; o resultado só pode vir de rodar o comando agora).
    const failingCommand = 'npx jest tests/unit/__nonexistent-file-forces-jest-nonzero-exit__.test.js';
    const { task, attempt } = await makeTaskAndAttempt({ testCommands: [failingCommand] });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      touchedPaths: [],
      risk: 'LOW',
      targetedCommands: task.test_commands,
    });

    expect(result.pass).toBe(false);
    expect(result.evidence.failed.length).toBeGreaterThan(0);
    expect(result.evidence.failed[0].command).toBe(failingCommand);

    const runs = await engineeringTaskService.listRegressionRuns(attempt.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe('FAIL');
  });

  test('RegressionPlan escala com o risco: MEDIUM inclui testes relacionados ao arquivo tocado, além do targeted', async () => {
    if (skipIfNoDatabase()) return;
    const { task, attempt } = await makeTaskAndAttempt({
      testCommands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
      risk: 'MEDIUM',
    });
    const workspace = await createWorkspace(task.id, attempt.attempt_number);
    createdWorkspaces.push(workspace);

    const result = await checkRegression({
      taskId: task.id,
      attemptId: attempt.id,
      workspacePath: workspace,
      // Nome escolhido para bater com um teste real existente no repositório
      // (tests/unit/engineeringRouterPathBoundary.test.js) via a heurística de basename.
      touchedPaths: ['engine/engineeringRouter/pathBoundary.js'],
      risk: 'MEDIUM',
      targetedCommands: task.test_commands,
    });

    expect(result.evidence.planTier).toBe('MEDIUM');
    // targeted (1) + pelo menos um teste relacionado a "pathBoundary" encontrado no repositório.
    expect(result.evidence.commandCount).toBeGreaterThan(1);
  });
});

describe('ERV1-CLOSE-004 — checkGovernance (subprocess real do gate canônico)', () => {
  test('gate real (validate-engineering-router-v1.js) executa de verdade e aprova no estado atual do repo', async () => {
    const result = await checkGovernance();
    expect(result.evidence.gate).toBe('validate-engineering-router-v1');
    expect(result.evidence.exitCode).toBe(0);
    expect(result.pass).toBe(true);
  });

  // DEFEITO PRÉ-EXISTENTE CORRIGIDO (2026-10-08): este teste mockava `child_process.execFile`, mas
  // `checkGovernance` executa o gate por `runChildWithDeadline` (`api/utils/operationDeadline`), que
  // usa `child_process.spawn`. O mock nunca era aplicado ao caminho real e, como o módulo mockado
  // não tinha `spawn`, a execução morria com `TypeError: spawn is not a function` — o teste ficava
  // vermelho PERMANENTE e o enforcement crítico ("reprovação do gate reprova a task") ficava SEM
  // PROVA. Um enforcement que não pode ser provado é um enforcement que se remove sem ninguém notar.
  test('reprovação real do gate é propagada como pass:false com evidência (spawn mockado, sem quebrar o gate real do repo)', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => {
      const actual = jest.requireActual('child_process');
      const { EventEmitter } = require('events');
      // Mesmo contrato consumido por `runChildWithDeadline`: stdout/stderr com 'data' + 'close' com code.
      const fakeSpawn = () => {
        const child = new EventEmitter();
        child.pid = 4242;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('[engineering-router-v1] status=FAIL checks=66 falhas=3\n - EXEMPLO: motivo simulado\n'));
          child.stderr.emit('data', Buffer.from('falha simulada do gate\n'));
          child.emit('close', 1, null);
        });
        return child;
      };
      return { ...actual, spawn: fakeSpawn };
    });

    const { checkGovernance: mockedCheckGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');
    const result = await mockedCheckGovernance();

    expect(result.pass).toBe(false);
    expect(result.evidence.exitCode).toBe(1);
    expect(result.evidence.summary.join(' ')).toContain('status=FAIL');

    jest.dontMock('child_process');
    jest.resetModules();
  });
});

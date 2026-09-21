'use strict';

/**
 * ERV1-CLOSE-004 — REGRESSION e GOVERNANCE precisam ser checagens reais, capazes de reprovar,
 * não transições de status decorativas.
 *
 * `checkRegression` reler do banco (Postgres real) que todo EngineeringTestRun de uma tentativa
 * é PASS/exitCode 0 — testado aqui com linhas reais inseridas via engineeringTaskService.
 * `checkGovernance` executa de verdade o gate canônico existente
 * (scripts/governance/validate-engineering-router-v1.js) como subprocess real.
 */

const sequelizeModule = require('../../api/db/sequelize');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { checkRegression, checkGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');

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

async function makeAttemptWithTestRuns(testRunSpecs) {
  const task = await engineeringTaskService.createTask({
    title: 'regression-governance-fixture',
    objective: 'objetivo de teste',
    allowedPaths: ['tests/unit/__fake.test.js'],
    testCommands: ['npm test'],
    maxIterations: 1,
  }, { createdBy: 'jest-regression-governance-test' });
  createdTaskIds.push(task.id);

  const attempt = await engineeringTaskService.createAttempt(task.id, { status: 'TESTED' });
  for (const spec of testRunSpecs) {
    await engineeringTaskService.createTestRun(attempt.id, {
      command: spec.command,
      status: spec.status,
      exit_code: spec.exitCode,
      duration_ms: 10,
    });
  }
  return attempt;
}

describe('ERV1-CLOSE-004 — checkRegression (Postgres real)', () => {
  test('todos os testRuns PASS/exitCode 0 → regressão aprova', async () => {
    if (skipIfNoDatabase()) return;
    const attempt = await makeAttemptWithTestRuns([
      { command: 'npm test', status: 'PASS', exitCode: 0 },
      { command: 'npx jest x', status: 'PASS', exitCode: 0 },
    ]);

    const result = await checkRegression(attempt.id);
    expect(result.pass).toBe(true);
    expect(result.evidence.testRunCount).toBe(2);
    expect(result.evidence.failed).toHaveLength(0);
  });

  test('um testRun FAIL real → regressão reprova (nunca GREEN sem evidência real)', async () => {
    if (skipIfNoDatabase()) return;
    const attempt = await makeAttemptWithTestRuns([
      { command: 'npm test', status: 'PASS', exitCode: 0 },
      { command: 'npx jest y', status: 'FAIL', exitCode: 1 },
    ]);

    const result = await checkRegression(attempt.id);
    expect(result.pass).toBe(false);
    expect(result.evidence.failed).toHaveLength(1);
    expect(result.evidence.failed[0].command).toBe('npx jest y');
  });

  test('sem nenhum testRun persistido → reprova explicitamente (nunca aprova por ausência de evidência)', async () => {
    if (skipIfNoDatabase()) return;
    const attempt = await makeAttemptWithTestRuns([]);

    const result = await checkRegression(attempt.id);
    expect(result.pass).toBe(false);
    expect(result.evidence.testRunCount).toBe(0);
  });
});

describe('ERV1-CLOSE-004 — checkGovernance (subprocess real do gate canônico)', () => {
  jest.setTimeout(30000);

  test('gate real (validate-engineering-router-v1.js) executa de verdade e aprova no estado atual do repo', async () => {
    const result = await checkGovernance();
    expect(result.evidence.gate).toBe('validate-engineering-router-v1');
    expect(result.evidence.exitCode).toBe(0);
    expect(result.pass).toBe(true);
  });

  test('reprovação real do gate é propagada como pass:false com evidência (exec mockado, sem quebrar o gate real do repo)', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => ({
      execFile: (file, args, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const err = new Error('gate reprovou');
        err.code = 1;
        err.stdout = '[engineering-router-v1] status=FAIL checks=66 falhas=3\n - EXEMPLO: motivo simulado';
        callback(err);
      },
    }));

    const { checkGovernance: mockedCheckGovernance } = require('../../api/services/engineeringRouter/regressionGovernanceService');
    const result = await mockedCheckGovernance();

    expect(result.pass).toBe(false);
    expect(result.evidence.exitCode).toBe(1);
    expect(result.evidence.summary.join(' ')).toContain('status=FAIL');

    jest.dontMock('child_process');
    jest.resetModules();
  });
});

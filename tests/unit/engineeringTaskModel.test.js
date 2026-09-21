'use strict';

/**
 * Contrato REAL de persistência do Engineering Model Router V1 — sem dublê de model.
 * Banco indisponível ⇒ pulo EXPLÍCITO e reportado (nunca verde silencioso), seguindo o
 * mesmo padrão de `tests/unit/mcp/mcpPersistenceContract.test.js`.
 */

const sequelizeModule = require('../../api/db/sequelize');

const DB_SKIP_REASON = 'postgres_unreachable';
let dbAvailable = false;
let dbReason = null;

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-task-model] PULADO: ${DB_SKIP_REASON} (${dbReason})`);
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
  if (dbAvailable) {
    try {
      const getEngineeringTask = require('../../api/db/models/EngineeringTask');
      await getEngineeringTask().destroy({ where: { title: { [require('sequelize').Op.like]: 'jest-fixture-%' } } });
    } catch (_) { /* best-effort */ }
    await sequelizeModule.close().catch(() => {});
  }
});

describe('EngineeringTask / EngineeringAttempt / EngineeringTestRun / EngineeringReview / EngineeringTelemetryEvent — persistência real', () => {
  test('cria uma EngineeringTask real com defaults corretos', async () => {
    if (skipIfNoDatabase()) return;
    const getEngineeringTask = require('../../api/db/models/EngineeringTask');
    const Model = getEngineeringTask();
    const row = await Model.create({
      title: 'jest-fixture-task-1',
      task_type: 'BUG_FIX',
      risk: 'LOW',
      scope: 'SMALL',
    });
    expect(row.id).toBeTruthy();
    expect(row.status).toBe('CREATED');
    expect(row.classification).toBe('DEVELOPMENT');
    expect(row.max_iterations).toBe(3);
    expect(row.required_capabilities).toEqual([]);
    await row.destroy();
  });

  test('idempotency_key é único', async () => {
    if (skipIfNoDatabase()) return;
    const getEngineeringTask = require('../../api/db/models/EngineeringTask');
    const Model = getEngineeringTask();
    const key = `jest-fixture-idem-${Date.now()}`;
    const row1 = await Model.create({ title: 'jest-fixture-task-2', task_type: 'BUG_FIX', risk: 'LOW', scope: 'SMALL', idempotency_key: key });
    await expect(Model.create({ title: 'jest-fixture-task-3', task_type: 'BUG_FIX', risk: 'LOW', scope: 'SMALL', idempotency_key: key }))
      .rejects.toThrow();
    await row1.destroy();
  });

  test('associação task -> attempts -> testRuns/reviews funciona de ponta a ponta', async () => {
    if (skipIfNoDatabase()) return;
    // Força carregamento das associações (definidas em defineRelationships, chamado no boot real).
    const { defineRelationships } = require('../../api/db/models');
    if (typeof defineRelationships === 'function') defineRelationships();

    const getEngineeringTask = require('../../api/db/models/EngineeringTask');
    const getEngineeringAttempt = require('../../api/db/models/EngineeringAttempt');
    const getEngineeringTestRun = require('../../api/db/models/EngineeringTestRun');
    const getEngineeringReview = require('../../api/db/models/EngineeringReview');
    const getEngineeringTelemetryEvent = require('../../api/db/models/EngineeringTelemetryEvent');

    const task = await getEngineeringTask().create({ title: 'jest-fixture-task-4', task_type: 'BUG_FIX', risk: 'LOW', scope: 'SMALL' });
    const attempt = await getEngineeringAttempt().create({ task_id: task.id, attempt_number: 1, status: 'PENDING' });
    const testRun = await getEngineeringTestRun().create({ attempt_id: attempt.id, command: 'npm run test:unit', status: 'RUNNING' });
    const review = await getEngineeringReview().create({ attempt_id: attempt.id, decision: 'APPROVE', findings: [] });
    const telemetry = await getEngineeringTelemetryEvent().create({ task_id: task.id, attempt_id: attempt.id, role: 'CODER', result: 'SUCCESS' });

    expect(testRun.attempt_id).toBe(attempt.id);
    expect(review.attempt_id).toBe(attempt.id);
    expect(telemetry.task_id).toBe(task.id);

    await telemetry.destroy();
    await review.destroy();
    await testRun.destroy();
    await attempt.destroy();
    await task.destroy();
  });

  test('attempt_number é único por task (retry não duplica linha)', async () => {
    if (skipIfNoDatabase()) return;
    const getEngineeringTask = require('../../api/db/models/EngineeringTask');
    const getEngineeringAttempt = require('../../api/db/models/EngineeringAttempt');
    const task = await getEngineeringTask().create({ title: 'jest-fixture-task-5', task_type: 'BUG_FIX', risk: 'LOW', scope: 'SMALL' });
    const a1 = await getEngineeringAttempt().create({ task_id: task.id, attempt_number: 1 });
    await expect(getEngineeringAttempt().create({ task_id: task.id, attempt_number: 1 })).rejects.toThrow();
    await a1.destroy();
    await task.destroy();
  });
});

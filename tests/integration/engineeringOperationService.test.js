'use strict';

/**
 * ER-V1-SEAL-002 (Full Durable Resume) — ciclo real de vida de uma EngineeringOperation
 * (Postgres real), provando o contrato completo que o reconciliador exige: primeira execução
 * roda; sucesso persiste e a próxima chamada RESUME (nunca re-executa); falha persiste e a
 * próxima chamada permite RETRY; RUNNING recente nunca é reexecutado concorrentemente
 * (FAIL_SAFE); RUNNING órfão exige RECONCILE explícito, nunca assume automaticamente.
 */

const crypto = require('crypto');
const sequelizeModule = require('../../api/db/sequelize');
const operationService = require('../../api/services/engineeringRouter/engineeringOperationService');

jest.setTimeout(30000);

let dbAvailable = false;
let dbReason = null;
// task_id na tabela engineering_operations é UUID (referencia EngineeringTask por convenção) —
// usar um UUID real, mesmo sem uma EngineeringTask persistida correspondente (este teste exercita
// só o controle de idempotência, não o vínculo de FK, que não existe explicitamente na migration).
const TASK_ID = crypto.randomUUID();

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-operation-service] PULADO: postgres_unreachable (${dbReason})`);
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

afterEach(async () => {
  if (!dbAvailable) return;
  const getEngineeringOperationModel = require('../../api/db/models/EngineeringOperation');
  const Model = getEngineeringOperationModel();
  await Model.destroy({ where: { task_id: TASK_ID } }).catch(() => {});
});

afterAll(async () => {
  await sequelizeModule.close().catch(() => {});
});

describe('ER-V1-SEAL-002 — engineeringOperationService (Postgres real)', () => {
  test('primeira chamada roda (RUN); completar persiste SUCCEEDED; segunda chamada nunca re-executa (RESUME)', async () => {
    if (skipIfNoDatabase()) return;
    const attemptId = crypto.randomUUID();
    const first = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'REGRESSION' });
    expect(first.action).toBe('RUN');

    await operationService.completeOperation(first.operation.id, { evidenceRef: { plan: 'HIGH' }, result: { pass: true } });

    const second = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'REGRESSION' });
    expect(second.action).toBe('RESUME');
    expect(second.operation.status).toBe('SUCCEEDED');
    expect(second.operation.evidence_ref).toEqual({ plan: 'HIGH' });
  });

  test('falha persiste FAILED; próxima chamada permite RETRY, e RETRY reabre a operation para RUNNING', async () => {
    if (skipIfNoDatabase()) return;
    const attemptId = crypto.randomUUID();
    const first = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'GOVERNANCE' });
    expect(first.action).toBe('RUN');
    await operationService.failOperation(first.operation.id, { error: new Error('gate reprovou de verdade') });

    const retry = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'GOVERNANCE' });
    expect(retry.action).toBe('RETRY');
    expect(retry.operation.status).toBe('RUNNING');
    expect(retry.operation.id).toBe(first.operation.id);
  });

  test('RUNNING recente nunca é reexecutado concorrentemente (FAIL_SAFE) — nunca duplica o efeito colateral', async () => {
    if (skipIfNoDatabase()) return;
    const attemptId = crypto.randomUUID();
    const first = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'PROMOTING' });
    expect(first.action).toBe('RUN');

    const concurrent = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'PROMOTING' });
    expect(concurrent.action).toBe('FAIL_SAFE');
    expect(concurrent.reason).toBe('OPERATION_STILL_RUNNING');
  });

  test('RUNNING órfão (simulado via started_at antigo) exige RECONCILE explícito — nunca reexecuta nem finge sucesso automaticamente', async () => {
    if (skipIfNoDatabase()) return;
    const attemptId = crypto.randomUUID();
    const first = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'POST_PROMOTION_VERIFY' });
    expect(first.action).toBe('RUN');

    const getEngineeringOperationModel = require('../../api/db/models/EngineeringOperation');
    const Model = getEngineeringOperationModel();
    await Model.update(
      { started_at: new Date(Date.now() - 20 * 60 * 1000) },
      { where: { id: first.operation.id } },
    );

    const reconcileNeeded = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'POST_PROMOTION_VERIFY' });
    expect(reconcileNeeded.action).toBe('RECONCILE');
    expect(reconcileNeeded.reason).toBe('RUNNING_STALE');

    const marked = await operationService.markUnknown(first.operation.id, { reason: 'evidência externa inconclusiva no teste' });
    expect(marked.status).toBe('UNKNOWN_REQUIRES_RECONCILIATION');

    const stillReconcile = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'POST_PROMOTION_VERIFY' });
    expect(stillReconcile.action).toBe('RECONCILE');
  });

  test('idempotencyKey isola fases e attempts distintos — nunca cruza controle de uma fase com outra', async () => {
    if (skipIfNoDatabase()) return;
    const attemptId = crypto.randomUUID();
    const codingOp = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'CODING' });
    const testingOp = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'TESTING' });
    expect(codingOp.operation.id).not.toBe(testingOp.operation.id);

    await operationService.completeOperation(codingOp.operation.id, { result: { patch: 'ok' } });
    const testingAfterCodingComplete = await operationService.beginOrReconcile({ taskId: TASK_ID, attemptId, phase: 'TESTING' });
    // TESTING continua RUNNING (própria fase), CODING ter completado não afeta TESTING.
    expect(testingAfterCodingComplete.action).toBe('FAIL_SAFE');
  });
});

'use strict';

const { reconcileOperation, DEFAULT_STALE_RUNNING_MS } = require('../../engine/engineeringRouter/operationReconciler');

describe('ER-V1-SEAL-002 — operationReconciler (puro, determinístico)', () => {
  test('nenhuma operation existente → RUN (primeira execução, nada a reconciliar)', () => {
    expect(reconcileOperation({ existingOperation: null })).toEqual({ action: 'RUN' });
  });

  test('operation SUCCEEDED → RESUME (reusa resultado já persistido, nunca re-executa)', () => {
    const result = reconcileOperation({ existingOperation: { status: 'SUCCEEDED' } });
    expect(result.action).toBe('RESUME');
  });

  test('operation FAILED → RETRY (falha definitiva anterior, seguro repetir do zero)', () => {
    const result = reconcileOperation({ existingOperation: { status: 'FAILED' } });
    expect(result.action).toBe('RETRY');
  });

  test('operation UNKNOWN_REQUIRES_RECONCILIATION → RECONCILE (nunca assume automaticamente)', () => {
    const result = reconcileOperation({ existingOperation: { status: 'UNKNOWN_REQUIRES_RECONCILIATION' } });
    expect(result.action).toBe('RECONCILE');
  });

  test('operation PENDING → RUN (nunca deveria sobreviver a restart sem virar RUNNING; seguro tratar como inexistente)', () => {
    const result = reconcileOperation({ existingOperation: { status: 'PENDING' } });
    expect(result.action).toBe('RUN');
  });

  test('operation RUNNING recente (dentro da janela) → FAIL_SAFE (pode estar rodando de verdade em outro processo agora)', () => {
    const now = Date.now();
    const result = reconcileOperation({
      existingOperation: { status: 'RUNNING', startedAt: new Date(now - 1000).toISOString() },
      nowMs: now,
    });
    expect(result.action).toBe('FAIL_SAFE');
    expect(result.reason).toBe('OPERATION_STILL_RUNNING');
  });

  test('operation RUNNING órfã (mais velha que o limiar de staleness) → RECONCILE (processo original provavelmente morreu no meio)', () => {
    const now = Date.now();
    const result = reconcileOperation({
      existingOperation: { status: 'RUNNING', startedAt: new Date(now - DEFAULT_STALE_RUNNING_MS - 1000).toISOString() },
      nowMs: now,
    });
    expect(result.action).toBe('RECONCILE');
    expect(result.reason).toBe('RUNNING_STALE');
  });

  test('operation RUNNING sem startedAt → MANUAL_REQUIRED (registro incompleto, nunca assume nada)', () => {
    const result = reconcileOperation({ existingOperation: { status: 'RUNNING' } });
    expect(result.action).toBe('MANUAL_REQUIRED');
    expect(result.reason).toBe('RUNNING_WITHOUT_STARTED_AT');
  });

  test('status desconhecido/corrompido → MANUAL_REQUIRED, nunca uma suposição automática', () => {
    const result = reconcileOperation({ existingOperation: { status: 'SOMETHING_ELSE' } });
    expect(result.action).toBe('MANUAL_REQUIRED');
    expect(result.reason).toBe('UNKNOWN_OPERATION_STATUS:SOMETHING_ELSE');
  });

  test('staleRunningMs customizado é respeitado (limiar configurável, não hardcoded na chamada)', () => {
    const now = Date.now();
    const customStaleMs = 500;
    const result = reconcileOperation({
      existingOperation: { status: 'RUNNING', startedAt: new Date(now - 600).toISOString() },
      nowMs: now,
      staleRunningMs: customStaleMs,
    });
    expect(result.action).toBe('RECONCILE');
  });
});

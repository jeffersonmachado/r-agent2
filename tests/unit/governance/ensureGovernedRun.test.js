/**
 * ensureGovernedRun.test.js — o run governado do source ATUAL é provisionado
 * pelo próprio pipeline (sem passo manual secreto), e nunca é reaproveitado
 * para um source diferente.
 */
'use strict';

const { decideRunProvisioning } = require('../../../scripts/governance/ensure-governed-run');

const FP = 'a'.repeat(64);
const OTHER_FP = 'b'.repeat(64);

describe('ensureGovernedRun — decisão de provisionamento', () => {
  test('sem run-context: cria run novo', () => {
    const decision = decideRunProvisioning({ currentFingerprint: FP, runContext: null, runExists: false });
    expect(decision.decision).toBe('CREATE');
    expect(decision.reason).toMatch(/sem governance\/\.current-run\.json/);
  });

  test('sem fingerprint corrente: cria (nunca reaproveita às cegas)', () => {
    const decision = decideRunProvisioning({
      currentFingerprint: null,
      runContext: { runId: 'run-1', sourceFingerprint: FP },
      runExists: true,
    });
    expect(decision.decision).toBe('CREATE');
  });

  test('RUN_SOURCE_DRIFT: run congelado de outro source cria run novo', () => {
    const decision = decideRunProvisioning({
      currentFingerprint: FP,
      runContext: { runId: 'run-1', sourceFingerprint: OTHER_FP },
      runExists: true,
    });
    expect(decision.decision).toBe('CREATE');
    expect(decision.reason).toMatch(/RUN_SOURCE_DRIFT/);
  });

  test('run ausente na persistência cria run novo (DB é a autoridade)', () => {
    const decision = decideRunProvisioning({
      currentFingerprint: FP,
      runContext: { runId: 'run-1', sourceFingerprint: FP },
      runExists: false,
    });
    expect(decision.decision).toBe('CREATE');
    expect(decision.reason).toMatch(/não existe na persistência/);
  });

  test('mesmo source + run persistido: reutiliza', () => {
    const decision = decideRunProvisioning({
      currentFingerprint: FP,
      runContext: { runId: 'run-1', sourceFingerprint: FP },
      runExists: true,
    });
    expect(decision.decision).toBe('REUSE');
  });
});

'use strict';

/**
 * FASE 16 — Replay hardened exige verificação determinística.
 *
 * Falha coberta (falharia antes da correção): registros hash-only vindos de
 * proof-signature.json eram classificados `hardened: true` apenas por terem
 * um hash assinado — sem análise de steps, sem failedStepCount, sem prova de
 * UI. Hash-only nunca conta como hardened.
 */

const { buildHashOnlyRecord, analyzeIndividualReplay } = require('../../../governance/replay-hardening-engine');

describe('replay-hardening — registros hash-only não são hardened', () => {
  test('buildHashOnlyRecord: hardened=false, status SIGNED_HASH_ONLY', () => {
    const record = buildHashOnlyRecord({ journeyId: 'support_ticket_flow', replayHash: 'abc123' });
    expect(record.hashOnly).toBe(true);
    expect(record.hardened).toBe(false);
    expect(record.status).toBe('SIGNED_HASH_ONLY');
    expect(record.violations).toEqual([]);
    expect(record.replayDeterministicHash).toBe('abc123');
    expect(record.replayExecutionHash).toBeNull();
  });

  test('replay com verificação determinística completa continua hardened', () => {
    const result = analyzeIndividualReplay(
      {
        journeyId: 'booking_flow',
        status: 'GO',
        failedStepCount: 0,
        failedStepIds: [],
        steps: [{ id: 's1', status: 'passed', actionType: 'send_message' }],
      },
      'fixture-replay.json',
      new Set(),
    );
    expect(result.hardened).toBe(true);
    expect(result.hashOnly).not.toBe(true);
  });

  test('replay com step falho não é hardened (modelo determinístico preservado)', () => {
    const result = analyzeIndividualReplay(
      { journeyId: 'booking_flow', status: 'GO', steps: [{ id: 's1', status: 'failed' }] },
      'fixture-replay.json',
      new Set(),
    );
    expect(result.hardened).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

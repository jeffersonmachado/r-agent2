'use strict';

/**
 * progressPolicy — separação formal entre LIVENESS (heartbeat) e AVANÇO (progresso).
 *
 * Prova o eixo central da missão de hardening: SLOW != STUCK != DEAD.
 *   - SLOW  = vivo + progredindo  → estado legítimo, NÃO se toca (TIMEOUT-05/09);
 *   - STUCK = vivo + sem avançar  → DIAGNÓSTICO, nunca kill (TIMEOUT-10/11);
 *   - DEAD  = liveness perdida    → decisão do lease, não deste módulo.
 */

const progress = require('../../engine/engineeringMission/progressPolicy');

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

describe('progressPolicy — heartbeat NÃO é progresso', () => {
  test('heartbeat/lease_renewal/poll_tick são RECUSADOS como progresso', () => {
    for (const signal of ['heartbeat', 'lease_renewal', 'poll_tick', 'keepalive']) {
      const out = progress.recordProgress({}, { signal, atMs: NOW });
      expect(out.accepted).toBe(false);
      expect(out.reason).toMatch(/liveness|não é progresso significativo/);
    }
  });

  test('sinais de AVANÇO são aceitos e marcam o instante', () => {
    for (const signal of progress.PROGRESS_SIGNALS) {
      const out = progress.recordProgress({}, { signal, atMs: NOW });
      expect(out.accepted).toBe(true);
      expect(out.record.lastMeaningfulProgressAt).toBe(iso(NOW));
      expect(out.record.lastProgressSignal).toBe(signal);
    }
  });

  test('marco NÃO retrocede com sinal fora de ordem', () => {
    const first = progress.recordProgress({}, { signal: 'test_result', atMs: NOW }).record;
    const late = progress.recordProgress(first, { signal: 'patch_produced', atMs: NOW - 60000 });
    expect(late.accepted).toBe(false);
    expect(late.record.lastMeaningfulProgressAt).toBe(iso(NOW));
  });

  test('progressCount acumula avanço (taxa de progresso, não wall-clock)', () => {
    let rec = {};
    rec = progress.recordProgress(rec, { signal: 'phase_change', atMs: NOW }).record;
    rec = progress.recordProgress(rec, { signal: 'test_result', atMs: NOW + 1000 }).record;
    expect(rec.progressCount).toBe(2);
  });
});

describe('progressPolicy — SLOW vs STUCK', () => {
  test('SEM marco de progresso não existe veredito (UNKNOWN, nunca NO_PROGRESS falso)', () => {
    const out = progress.evaluateProgress({}, { nowMs: NOW, phase: 'TESTING' });
    expect(out.state).toBe(progress.PROGRESS_STATES.UNKNOWN);
    expect(out.actions).toEqual([]);
    expect(out.reason).toMatch(/sem marco/i);
  });

  test('task LONGA progredindo continua PROGRESSING (TIMEOUT-05: tempo não derruba)', () => {
    // 40 minutos de fase TESTING, muito além do limiar default de 15min, mas com
    // progresso recente: é SLOW, não STUCK.
    const record = { lastMeaningfulProgressAt: iso(NOW - 40 * 60 * 1000) };
    const out = progress.evaluateProgress(record, {
      nowMs: NOW - 39 * 60 * 1000,
      phase: 'TESTING',
    });
    expect(out.state).toBe(progress.PROGRESS_STATES.PROGRESSING);
    expect(out.silentForMs).toBe(60 * 1000);
    expect(out.actions).toEqual([]);
  });

  test('worker VIVO mas sem progresso → NO_PROGRESS com ações de diagnóstico (TIMEOUT-10)', () => {
    const record = { lastMeaningfulProgressAt: iso(NOW - 31 * 60 * 1000) };
    const out = progress.evaluateProgress(record, { nowMs: NOW, phase: 'TESTING', heartbeatAgeMs: 5000 });
    expect(out.state).toBe(progress.PROGRESS_STATES.NO_PROGRESS);
    expect(out.livenessFresh).toBe(true); // VIVO, apesar de travado
    expect(out.actions).toContain('wait');
    expect(out.actions).toContain('cancel_operation');
    expect(out.actions).toContain('switch_provider');
    expect(out.actions).toContain('replan_task');
    expect(out.diagnosis.classifyBeforeActing).toBe(true);
  });

  test('NO_PROGRESS NÃO mata: a lista de ações não contém kill/takeover', () => {
    const record = { lastMeaningfulProgressAt: iso(NOW - 60 * 60 * 1000) };
    const out = progress.evaluateProgress(record, { nowMs: NOW, phase: 'REGRESSION' });
    expect(out.actions.some((a) => /kill|fail_mission|takeover|expire_lease/i.test(a))).toBe(false);
  });

  test('limiar é POR FASE: REGRESSION tolera mais silêncio que REVIEWING', () => {
    const record = { lastMeaningfulProgressAt: iso(NOW - 20 * 60 * 1000) };
    const regression = progress.evaluateProgress(record, { nowMs: NOW, phase: 'REGRESSION' });
    const reviewing = progress.evaluateProgress(record, { nowMs: NOW, phase: 'REVIEWING' });
    expect(regression.state).toBe(progress.PROGRESS_STATES.PROGRESSING); // 45min de tolerância
    expect(reviewing.state).toBe(progress.PROGRESS_STATES.NO_PROGRESS); // 15min de tolerância
    expect(reviewing.thresholdMs).toBeLessThan(regression.thresholdMs);
  });

  test('policy explícita por fase tem precedência sobre o default', () => {
    const record = { lastMeaningfulProgressAt: iso(NOW - 5000) };
    const out = progress.evaluateProgress(record, {
      nowMs: NOW,
      phase: 'TESTING',
      policy: { perPhase: { TESTING: 1000 }, default: 60000 },
    });
    expect(out.state).toBe(progress.PROGRESS_STATES.NO_PROGRESS);
    expect(out.thresholdMs).toBe(1000);
  });
});

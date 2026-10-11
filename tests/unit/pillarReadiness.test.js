const { evaluatePillars, evaluateSmokeSummary } = require('../../tools/system/lib/pillar-readiness');

function makePassSmokes() {
  return {
    l01: {
      status: 'pass',
      evidence: {
        queueId: 'q1',
        ticketId: 't1',
        transitions: {
          callNext: true,
          start: true,
          pause: true,
          resume: true,
          finish: true,
        },
        metrics: {
          doneCount: 1,
        },
      },
    },
    l02: { status: 'pass', evidence: { ok: true } },
    l03: {
      status: 'pass',
      evidence: {
        ok: true,
        realCall: {
          attempted: true,
          click2callStatus: 'originated',
          cdrFound: false,
        },
      },
    },
    l04: {
      status: 'pass',
      evidence: {
        ok: true,
        flow: {
          executionId: 'fx-1',
          nodesCount: 2,
        },
      },
    },
    l05: {
      status: 'pass',
      evidence: {
        ok: true,
        ticket: { id: 'ticket-1' },
        operations: {
          assign: true,
          transfer: true,
          note: true,
          addTag: true,
          removeTag: true,
          quickReplyCreate: true,
          quickReplyUse: true,
          quickReplyList: true,
        },
      },
    },
  };
}

describe('pillar-readiness', () => {
  test('returns ok for all pillars when all smoke evidence is valid', () => {
    const result = evaluatePillars(makePassSmokes());
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.pillars.chatpro.ok).toBe(true);
    expect(result.pillars.queue.ok).toBe(true);
    expect(result.pillars.pbx.ok).toBe(true);
    expect(result.pillars.pbx.l03.acceptedWithoutCdr).toBe(true);
  });

  test('returns failures when chatpro and queue evidence are incomplete', () => {
    const smokes = makePassSmokes();
    smokes.l01.evidence.metrics.doneCount = 0;
    smokes.l05.evidence.operations.quickReplyUse = false;

    const result = evaluatePillars(smokes);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('l01_evidence_invalid');
    expect(result.reasons).toContain('l05_omnichannel_invalid');
    expect(result.pillars.queue.ok).toBe(false);
    expect(result.pillars.chatpro.ok).toBe(false);
  });
});

describe('evaluateSmokeSummary — pilares E frescor (P1-14)', () => {
  const NOW = Date.parse('2026-10-10T12:00:00.000Z');
  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString();

  test('pilares passando com evidência FRESCA é ok', () => {
    const result = evaluateSmokeSummary(
      { generatedAt: iso(NOW - 2 * DAY), smokes: makePassSmokes() },
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.freshness.status).toBe('FRESH');
  });

  test('pilares passando com evidência de 50,8 DIAS NÃO é ok — é o defeito que este teste trava', () => {
    const stale = { generatedAt: '2026-08-21T01:26:02.857Z', smokes: makePassSmokes() };
    // O critério ANTIGO (só pilares) aprovava: é exatamente o furo medido no
    // go-no-go, que decidia GO com a evidência de dois meses.
    expect(evaluatePillars(stale.smokes).ok).toBe(true);
    const result = evaluateSmokeSummary(stale, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('smoke_evidence_stale');
    expect(result.freshness.status).toBe('STALE');
  });

  test('evidência sem timestamp não vira stale (ausência de dado não é dado)', () => {
    const result = evaluateSmokeSummary({ smokes: makePassSmokes() }, { now: NOW });
    expect(result.freshness.status).toBe('UNKNOWN');
    expect(result.reasons).not.toContain('smoke_evidence_stale');
    expect(result.ok).toBe(true);
  });

  test('os dois motivos coexistem: pilar inválido E evidência vencida', () => {
    const smokes = makePassSmokes();
    smokes.l01.status = 'fail';
    const result = evaluateSmokeSummary({ generatedAt: '2026-08-21T01:26:02.857Z', smokes }, { now: NOW });
    expect(result.reasons).toContain('l01_not_pass');
    expect(result.reasons).toContain('smoke_evidence_stale');
  });

  test('TLT menor do produtor é respeitado (mesma flexibilidade do módulo puro)', () => {
    const result = evaluateSmokeSummary(
      { generatedAt: iso(NOW - 3 * DAY), smokes: makePassSmokes() },
      { now: NOW, maxAgeMs: 48 * 3600000 },
    );
    expect(result.reasons).toContain('smoke_evidence_stale');
  });

  test('resumo ausente não explode e acusa os pilares faltantes', () => {
    const result = evaluateSmokeSummary(null, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('l01_not_pass');
  });
});

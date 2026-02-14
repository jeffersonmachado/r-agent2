const { evaluatePillars } = require('../../tools/system/lib/pillar-readiness');

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

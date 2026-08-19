'use strict';

/**
 * FASE 16 — Readiness consome blockingGaps do final-proof-report.
 *
 * Falha coberta (falharia antes da correção): a decisão de readiness ignorava
 * os blockingGaps do proof engine — um blocker fatal no final-proof-report
 * podia coexistir com GO/AUTONOMOUS_READY. Agora gap crítico bloqueia
 * (NO_GO:PROOF_BLOCKING_GAPS) e gap high rebaixa o nível para
 * CONTROLLED_PILOT.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evalProofGaps,
  classifyDecision,
  classifyReadinessLevel,
  READINESS_LEVELS,
} = require('../../../governance/shared/readiness-decision-engine');

function makeRootWithProof(proof) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-proof-'));
  if (proof !== null) {
    const dir = path.join(root, 'governance');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'final-proof-report.json'), JSON.stringify(proof), 'utf8');
  }
  return root;
}

describe('readiness-decision-engine — evalProofGaps', () => {
  test('blockingGap critical → blocked (blocker fatal nunca coexiste com GO)', () => {
    const root = makeRootWithProof({
      blockingGaps: [{ id: 'gap-proof-stale-fingerprints', severity: 'critical' }],
    });
    const result = evalProofGaps(root);
    expect(result.blocked).toBe(true);
    expect(result.fatalGaps).toBe(1);
    expect(result.blocker).toContain('proof-blocking-gaps=1');
  });

  test('blockingGap high (sem critical) → não bloqueia, mas conta para nível', () => {
    const root = makeRootWithProof({
      blockingGaps: [{ id: 'gap-proof-pbx-prod-like', severity: 'high' }],
    });
    const result = evalProofGaps(root);
    expect(result.blocked).toBe(false);
    expect(result.highGaps).toBe(1);
  });

  test('sem blockingGaps → não bloqueia', () => {
    const root = makeRootWithProof({ blockingGaps: [] });
    expect(evalProofGaps(root).blocked).toBe(false);
  });

  test('final-proof-report ausente → fail-closed (blocked)', () => {
    const root = makeRootWithProof(null);
    const result = evalProofGaps(root);
    expect(result.blocked).toBe(true);
    expect(result.blocker).toContain('final-proof-report.json ausente');
  });
});

describe('readiness-decision-engine — classifyDecision com proof gaps', () => {
  test('proof-blocking-gaps mapeia para NO_GO:PROOF_BLOCKING_GAPS', () => {
    expect(classifyDecision(['proof-blocking-gaps=2 critical [gap-a, gap-b]']))
      .toBe('NO_GO:PROOF_BLOCKING_GAPS');
  });

  test('sem blockers → AUTONOMOUS_READY_GO (inalterado)', () => {
    expect(classifyDecision([])).toBe('AUTONOMOUS_READY_GO');
  });
});

describe('readiness-decision-engine — níveis canônicos de readiness', () => {
  test('taxonomia exposta: NO_GO, CONTROLLED_PILOT, PRODUCTION_READY, AUTONOMOUS_READY', () => {
    expect(READINESS_LEVELS).toEqual(['NO_GO', 'CONTROLLED_PILOT', 'PRODUCTION_READY', 'AUTONOMOUS_READY']);
  });

  test('decisão NO_GO → nível NO_GO', () => {
    expect(classifyReadinessLevel({ decision: 'NO_GO:PROOF_BLOCKING_GAPS', score: 86, components: [] })).toBe('NO_GO');
  });

  test('GO com findings high → CONTROLLED_PILOT', () => {
    const components = [{ component: 'proof_gaps', highGaps: 2 }];
    expect(classifyReadinessLevel({ decision: 'AUTONOMOUS_READY_GO', score: 100, components })).toBe('CONTROLLED_PILOT');
  });

  test('GO com score máximo e sem findings → AUTONOMOUS_READY', () => {
    expect(classifyReadinessLevel({ decision: 'AUTONOMOUS_READY_GO', score: 100, components: [] })).toBe('AUTONOMOUS_READY');
  });

  test('GO sem findings mas score < 100 → PRODUCTION_READY', () => {
    expect(classifyReadinessLevel({ decision: 'AUTONOMOUS_READY_GO', score: 86, components: [] })).toBe('PRODUCTION_READY');
  });
});

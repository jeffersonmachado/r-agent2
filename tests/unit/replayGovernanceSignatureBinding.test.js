'use strict';

/**
 * Binding da assinatura de governança ao artefato de replay.
 *
 * Defeito provado (2026-09-13): `governanceMessage()` montava a mensagem com
 * `stable()`, e `stable()` remove as chaves de `INTEGRITY_FIELDS` — que inclui
 * `replayHash`. O campo era descartado da mensagem e a assinatura HMAC passava a
 * cobrir apenas `{ blockers, goNoGo, isOperational }`.
 *
 * Consequência observada em evidência real
 * (`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`): 9 artefatos
 * com `replayHash` distintos compartilhavam a MESMA `governanceSignature`
 * (`hmac-sha256:ad9f92ac…`), ou seja, a assinatura era portável entre artefatos e
 * entre tenants — não certificava nada além da decisão.
 */

process.env.REPLAY_SIGNING_KEY = process.env.REPLAY_SIGNING_KEY
  || 'test-replay-signing-key-with-at-least-32-bytes';

const {
  computeGovernanceSignature,
  signReplayArtifact,
  validateReplayIntegrity,
  computeReplayHash,
} = require('../../lib/replayIntegrity');

const GOVERNANCE = { goNoGo: 'GO', isOperational: true, blockers: [] };

function baseReplay(overrides = {}) {
  return {
    id: 'replay-1',
    journeyId: 'support_ticket_flow',
    tenantId: 'system',
    environment: 'test',
    generatedAt: '2026-09-13T00:00:00.000Z',
    events: [{ type: 'step', id: 'a', payload: { value: 1 } }],
    postStateSummary: { tickets: 1 },
    ...overrides,
  };
}

describe('assinatura de governança deve ligar o artefato (não só a decisão)', () => {
  test('artefatos diferentes com a mesma decisão produzem assinaturas diferentes', () => {
    const a = baseReplay({ journeyId: 'support_ticket_flow', events: [{ type: 'step', id: 'a' }] });
    const b = baseReplay({ journeyId: 'fitness_customer_checkin', events: [{ type: 'step', id: 'b' }] });

    expect(computeReplayHash(a)).not.toBe(computeReplayHash(b));

    const sigA = computeGovernanceSignature(a, GOVERNANCE);
    const sigB = computeGovernanceSignature(b, GOVERNANCE);

    expect(sigA).not.toBe(sigB);
  });

  test('mesmo artefato e mesma decisão produzem assinatura idêntica (determinismo)', () => {
    const a = baseReplay();
    expect(computeGovernanceSignature(a, GOVERNANCE)).toBe(computeGovernanceSignature(a, GOVERNANCE));
  });

  test('decisão de governança diferente produz assinatura diferente no mesmo artefato', () => {
    const a = baseReplay();
    const go = computeGovernanceSignature(a, { goNoGo: 'GO', isOperational: true, blockers: [] });
    const noGo = computeGovernanceSignature(a, { goNoGo: 'NO_GO', isOperational: false, blockers: [{ reason: 'x' }] });
    expect(go).not.toBe(noGo);
  });

  test('assinatura não é portável entre tenants', () => {
    const tenantA = baseReplay({ tenantId: 'system' });
    const tenantB = baseReplay({ tenantId: 'cliente-vizinho' });

    const sigA = computeGovernanceSignature(tenantA, GOVERNANCE);
    const sigB = computeGovernanceSignature(tenantB, GOVERNANCE);

    expect(sigA).not.toBe(sigB);
  });

  test('assinatura detecta violação do artefato assinado', () => {
    const signed = signReplayArtifact(baseReplay(), { governance: GOVERNANCE });
    const intact = validateReplayIntegrity(signed, signed.governance);
    expect(intact.valid).toBe(true);
    expect(intact.blockers).toEqual([]);

    const tampered = {
      ...signed,
      postStateSummary: { tickets: 999 },
    };
    // O hash cobre o artefato; a assinatura precisa cobrir o mesmo conteúdo.
    const result = validateReplayIntegrity(tampered, tampered.governance);
    expect(result.valid).toBe(false);
    const reasons = result.blockers.map((item) => item.reason);
    expect(reasons).toContain('replay_hash_mismatch');
  });

  test('assinatura é estável e verificável para o artefato assinado', () => {
    const signed = signReplayArtifact(baseReplay(), { governance: GOVERNANCE });
    const recomputed = computeGovernanceSignature(signed, signed.governance);
    expect(recomputed).toBe(signed.governanceSignature);
  });
});

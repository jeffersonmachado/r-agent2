'use strict';

const {
  signArtifact,
  verifySeal,
} = require('../../governance/sign-governance');
const { signReplayArtifact, validateReplayIntegrity } = require('../../lib/replayIntegrity');

describe('governance package seals', () => {
  const signingKey = 'a-secure-test-signing-key-with-at-least-32-bytes';
  const differentKey = 'a-different-test-signing-key-at-least-32-bytes';

  function sign() {
    return signArtifact({
      subject: 'replay-chain',
      hash: 'a'.repeat(64),
      chainRoot: 'b'.repeat(64),
      gitCommit: 'deadbeef',
      timestamp: '2026-08-14T12:00:00.000Z',
      extra: 'replays:1',
      signingKey,
    });
  }

  test('verifies only with the configured secret', () => {
    const seal = sign();
    expect(seal.signatureVersion).toBe(2);
    expect(seal.keyDerivation).toBe('hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)');
    expect(verifySeal(seal, { signingKey })).toBe(true);
    expect(verifySeal(seal, { signingKey: differentKey })).toBe(false);
  });

  test('rejects content tampering', () => {
    const seal = sign();
    expect(verifySeal({ ...seal, chainRoot: 'c'.repeat(64) }, { signingKey })).toBe(false);
  });

  test('rejects legacy seals derived only from a public commit', () => {
    const seal = sign();
    const legacy = {
      ...seal,
      signatureVersion: 1,
      keyDerivation: 'sha256(rap-governance-v1:deadbeef)',
    };
    expect(verifySeal(legacy, { signingKey })).toBe(false);
  });

  test('boundary tenant prevalece sobre tenant forjado no replay', () => {
    const replay = signReplayArtifact(
      { replayId: 'r-1', tenantId: 'tenant-forjado', success: true },
      {
        tenantId: 'tenant-autenticado',
        governance: { goNoGo: 'GO', isOperational: true, blockers: [] },
        signingKey,
      },
    );

    expect(replay.tenantId).toBe('tenant-autenticado');
    expect(validateReplayIntegrity(replay, replay.governance, { signingKey }).valid).toBe(true);
  });
});

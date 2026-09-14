'use strict';

/**
 * Sinal de leitura de replay: "não encontrado" ≠ "integridade falhou".
 *
 * Defeito provado (2026-09-13): `getReplayFile` devolvia `null` quando a
 * verificação de integridade falhava, e o endpoint respondia
 * **404 "Replay não encontrado"** para um artefato que EXISTE. O sintoma só
 * apareceu exercitando a UI: a lista de replays oferecia entradas cujo detalhe
 * retornava 404 e o modal abria vazio.
 *
 * Isso tornou invisível a regressão da migração de assinatura: os 118 replays
 * gravados em `~/.local/share/ragent2-runtime/rpa/replay` estavam com
 * `governance_signature_mismatch` (assinados pelo algoritmo antigo) e todos
 * pareciam "não encontrados" em vez de "integridade falhou".
 */

process.env.REPLAY_SIGNING_KEY = process.env.REPLAY_SIGNING_KEY
  || 'test-replay-signing-key-with-at-least-32-bytes';

const { signReplayArtifact } = require('../../lib/replayIntegrity');
const { assertReplayIntegrityForRead } = require('../../api/services/testExecutionService');

const GOVERNANCE = { goNoGo: 'GO', isOperational: true, blockers: [] };

function artifact(overrides = {}) {
  return {
    id: 'replay-signal-1',
    journeyId: 'support_ticket_flow',
    tenantId: 'system',
    environment: 'test',
    generatedAt: '2026-09-13T00:00:00.000Z',
    events: [{ type: 'step', id: 'a' }],
    postStateSummary: { tickets: 1 },
    ...overrides,
  };
}

describe('assertReplayIntegrityForRead — falha de integridade é explícita', () => {
  test('artefato assinado e íntegro é aceito', () => {
    const signed = signReplayArtifact(artifact(), { governance: GOVERNANCE });
    expect(assertReplayIntegrityForRead(signed)).toBe(true);
  });

  test('artefato assinado mas adulterado lança REPLAY_INTEGRITY_FAILED (não null)', () => {
    const signed = signReplayArtifact(artifact(), { governance: GOVERNANCE });
    const tampered = { ...signed, postStateSummary: { tickets: 999 } };

    let error = null;
    try {
      assertReplayIntegrityForRead(tampered);
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.code).toBe('REPLAY_INTEGRITY_FAILED');
    expect(Array.isArray(error.blockers)).toBe(true);
    expect(error.blockers.length).toBeGreaterThan(0);
    expect(error.blockers.map((b) => b.reason)).toContain('replay_hash_mismatch');
  });

  test('assinatura do algoritmo antigo é reportada como integridade, não como ausência', () => {
    const signed = signReplayArtifact(artifact(), { governance: GOVERNANCE });
    // Simula assinatura emitida por algoritmo anterior (valor divergente).
    const legacy = {
      ...signed,
      governanceSignature: 'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000',
      integrity: { ...signed.integrity, governanceSignature: 'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000' },
    };

    let error = null;
    try {
      assertReplayIntegrityForRead(legacy);
    } catch (err) {
      error = err;
    }
    expect(error).not.toBeNull();
    expect(error.code).toBe('REPLAY_INTEGRITY_FAILED');
    expect(error.blockers.map((b) => b.reason)).toContain('governance_signature_mismatch');
    expect(error.message).toMatch(/integridade/i);
  });

  test('artefato não assinado não é bloqueado em desenvolvimento', () => {
    const unsigned = artifact();
    expect(assertReplayIntegrityForRead(unsigned)).toBe(false);
  });
});

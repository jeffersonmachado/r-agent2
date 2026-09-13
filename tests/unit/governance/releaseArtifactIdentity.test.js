/**
 * releaseArtifactIdentity.test.js — R4..R7, R23, R34..R37, G6, C4, C5:
 * identidade de artefato, cadeia de lineage e recusa de promoção artificial.
 */
'use strict';

const crypto = require('crypto');

const {
  CANDIDATE_ARTIFACT_TYPE,
  DELIVERED_ARTIFACT_TYPE,
  IDENTITY_CODES,
  validateCandidateManifest,
  validateDeliveredManifest,
  validateLineageChain,
  validateArtifactHashBinding,
  validateRunIsolation,
  verifyReleaseIdentity,
} = require('../../../governance/release-artifact-identity');

const sha = (seed) => crypto.createHash('sha256').update(String(seed)).digest('hex');
const COMMIT = 'a'.repeat(40);

function candidate(overrides = {}) {
  return {
    artifactType: CANDIDATE_ARTIFACT_TYPE,
    releasePhase: 'CANDIDATE_BUILT',
    release: 'r-agent2-20260913-120000',
    candidateHash: sha('candidate-bytes'),
    sourceCommit: COMMIT,
    sourceFingerprint: sha('source'),
    governanceRunId: 'rap-governed-20260913120000000-abcdef01',
    createdAt: '2026-09-13T12:00:00.000Z',
    canonicalPath: 'dist/candidate/r-agent2-20260913-120000.candidate.zip',
    ...overrides,
  };
}

function delivered(overrides = {}) {
  return {
    artifactType: DELIVERED_ARTIFACT_TYPE,
    releasePhase: 'DELIVERED',
    release: 'r-agent2-20260913-120000',
    sourceCommit: COMMIT,
    sourceFingerprint: sha('source'),
    candidateHash: sha('candidate-bytes'),
    parentCandidateHash: sha('candidate-bytes'),
    finalPayloadHash: sha('payload-bytes'),
    governanceRunId: 'rap-governed-20260913120000000-abcdef01',
    createdAt: '2026-09-13T12:05:00.000Z',
    ...overrides,
  };
}

describe('ReleaseArtifactIdentity — identidade do candidato', () => {
  test('candidato bem formado é aceito', () => {
    const result = validateCandidateManifest(candidate());
    expect(result.valid).toBe(true);
  });

  test('C4 — candidato rotulado DELIVERED é promoção artificial', () => {
    const result = validateCandidateManifest(candidate({ artifactType: 'DELIVERED_PAYLOAD' }));
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.CANDIDATE_PROMOTED);
  });

  test('fase do candidato não pode ser DELIVERED/FINAL', () => {
    for (const phase of ['DELIVERED', 'FINAL_GOVERNANCE', 'PUBLISHED_VERIFIED']) {
      const result = validateCandidateManifest(candidate({ releasePhase: phase }));
      expect(result.valid).toBe(false);
      expect(result.code).toBe(IDENTITY_CODES.PHASE_MISMATCH);
    }
  });

  test('campos obrigatórios ausentes reprovam com a lista exata', () => {
    const broken = candidate();
    delete broken.sourceFingerprint;
    delete broken.governanceRunId;
    const result = validateCandidateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['sourceFingerprint', 'governanceRunId']);
  });

  test('hash que não é SHA-256 completo reprova', () => {
    const result = validateCandidateManifest(candidate({ candidateHash: 'deadbeef' }));
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.HASH_NOT_SHA256);
  });
});

describe('ReleaseArtifactIdentity — identidade do payload entregue', () => {
  test('payload entregue bem formado é aceito', () => {
    expect(validateDeliveredManifest(delivered()).valid).toBe(true);
  });

  test('tipo errado (candidato apresentado como entregue) reprova', () => {
    const result = validateDeliveredManifest(delivered({ artifactType: 'CANDIDATE' }));
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.TYPE_MISMATCH);
  });

  test('identidade incompleta reprova', () => {
    const broken = delivered();
    delete broken.parentCandidateHash;
    const result = validateDeliveredManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['parentCandidateHash']);
  });
});

describe('ReleaseArtifactIdentity — cadeia de lineage (R7/R23/R35)', () => {
  test('cadeia consistente é aceita e declara a ordem criptográfica', () => {
    const result = validateLineageChain({ candidate: candidate(), delivered: delivered() });
    expect(result.valid).toBe(true);
    expect(result.chain).toEqual([
      'SOURCE_FINGERPRINT',
      'CANDIDATE_HASH',
      'FINAL_PAYLOAD_HASH',
      'PACKAGE_MANIFEST',
      'SIGNATURE',
      'PUBLICATION',
    ]);
  });

  test('parentCandidateHash diferente do candidato quebra a cadeia', () => {
    const result = validateLineageChain({
      candidate: candidate(),
      delivered: delivered({ parentCandidateHash: sha('outro-candidato') }),
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.LINEAGE_CHAIN_BROKEN);
  });

  test('sourceCommit divergente entre candidato e entregue reprova', () => {
    const result = validateLineageChain({
      candidate: candidate(),
      delivered: delivered({ sourceCommit: 'b'.repeat(40) }),
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.SOURCE_MISMATCH);
  });

  test('C5 — runId estrangeiro no entregue reprova', () => {
    const result = validateLineageChain({
      candidate: candidate(),
      delivered: delivered({ governanceRunId: 'rap-governed-20260101000000000-ffffffff' }),
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.FOREIGN_RUN);
  });

  test('R23 — candidato mutado depois da validação quebra a cadeia', () => {
    const candidateA = candidate();
    const deliveredA = delivered();
    expect(validateLineageChain({ candidate: candidateA, delivered: deliveredA }).valid).toBe(true);

    // Bytes do candidato mudam -> novo candidateHash, mesma cadeia do entregue.
    const mutated = candidate({ candidateHash: sha('candidate-bytes-mutados') });
    const result = validateLineageChain({ candidate: mutated, delivered: deliveredA });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.LINEAGE_CHAIN_BROKEN);
  });
});

describe('ReleaseArtifactIdentity — binding de hash e isolamento de run', () => {
  test('G6 — hash declarado igual aos bytes reais é aceito', () => {
    const result = validateArtifactHashBinding({
      manifest: delivered(),
      field: 'finalPayloadHash',
      actualHash: sha('payload-bytes'),
      artifactLabel: 'payload.zip',
    });
    expect(result.valid).toBe(true);
  });

  test('C4 — payload copiado (bytes diferentes do declarado) reprova', () => {
    const result = validateArtifactHashBinding({
      manifest: delivered(),
      field: 'finalPayloadHash',
      actualHash: sha('bytes-de-outro-zip'),
      artifactLabel: 'payload.zip',
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.HASH_MISMATCH);
  });

  test('run corrente ausente reprova (não há como provar isolamento)', () => {
    const result = validateRunIsolation({ candidate: candidate(), delivered: delivered(), currentRun: null });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.IDENTITY_MISSING);
  });

  test('artefatos do run corrente passam o isolamento', () => {
    const currentRun = { runId: 'rap-governed-20260913120000000-abcdef01', sourceFingerprint: sha('source') };
    const result = validateRunIsolation({ candidate: candidate(), delivered: delivered(), currentRun });
    expect(result.valid).toBe(true);
  });

  test('C5 — candidato de run anterior reprova o isolamento', () => {
    const currentRun = { runId: 'rap-governed-20260913130000000-11111111', sourceFingerprint: sha('source') };
    const result = validateRunIsolation({ candidate: candidate(), delivered: delivered(), currentRun });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.FOREIGN_RUN);
  });
});

describe('ReleaseArtifactIdentity — verificação completa', () => {
  test('cadeia completa e hashes corretos => PASS', () => {
    const currentRun = { runId: 'rap-governed-20260913120000000-abcdef01', sourceFingerprint: sha('source') };
    const result = verifyReleaseIdentity({
      candidate: candidate(),
      delivered: delivered(),
      candidateActualHash: sha('candidate-bytes'),
      deliveredActualHash: sha('payload-bytes'),
      currentRun,
    });
    expect(result.valid).toBe(true);
    expect(result.status).toBe('PASS');
    expect(result.failures).toEqual([]);
    expect(result.checks.map((c) => c.check)).toEqual([
      'candidate_identity',
      'delivered_identity',
      'lineage_chain',
      'candidate_hash_binding',
      'delivered_hash_binding',
      'run_isolation',
    ]);
  });

  test('um único defeito já reprova a verificação completa', () => {
    const currentRun = { runId: 'rap-governed-20260913120000000-abcdef01', sourceFingerprint: sha('source') };
    const result = verifyReleaseIdentity({
      candidate: candidate(),
      delivered: delivered(),
      candidateActualHash: sha('candidate-bytes'),
      deliveredActualHash: sha('payload-de-outro-release'),
      currentRun,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe(IDENTITY_CODES.HASH_MISMATCH);
  });
});

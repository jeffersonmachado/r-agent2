'use strict';

/**
 * release-artifact-identity.js — identidade e LINEAGE dos artefatos de release.
 *
 * CONTEXTO (R4..R7, R23, R34..R37, G6)
 * Antes deste módulo, "release" era um nome genérico para coisas diferentes:
 * o ZIP provisional em `dist/`, o payload em `dist/release/*.payload.zip` e o
 * envelope. Sem identidade explícita, era impossível distinguir um CANDIDATO
 * de um artefato ENTREGUE — e a única barreira contra "promover candidate para
 * delivered" era a ordem dos `mv` no shell.
 *
 * MODELO
 *   CANDIDATE          — `dist/candidate/<release>.candidate.zip`
 *                        artifactType=CANDIDATE, releasePhase∈{CANDIDATE_BUILT,
 *                        CANDIDATE_VALIDATED}. NUNCA DELIVERED/PUBLISHED/FINAL.
 *   DELIVERED_PAYLOAD  — `dist/release/<release>.payload.zip`
 *                        artifactType=DELIVERED_PAYLOAD, provado por manifesto
 *                        EXTERNO que carrega parentCandidateHash e
 *                        finalPayloadHash.
 *
 * CADEIA (R7)
 *   SOURCE_FINGERPRINT -> CANDIDATE_HASH -> FINAL_PAYLOAD_HASH ->
 *   PACKAGE_MANIFEST -> SIGNATURE -> PUBLICATION
 *
 * NÃO MUTAÇÃO RETROATIVA (R23)
 *   O ZIP do candidato NUNCA é reescrito. O payload final é um artefato
 *   DERIVADO, e o manifesto registra `parentCandidateHash` — se os bytes do
 *   candidato mudarem, a cadeia quebra e o verificador reprova.
 *
 * PARADOXO DO AUTO-HASH (R25)
 *   O hash do payload final vive no manifesto EXTERNO (sidecar/identity), nunca
 *   dentro dos bytes que ele cobre.
 *
 * Este módulo é PURO: valida OBJETOS. O hashing e a leitura de disco ficam no
 * CLI `scripts/governance/verify-release-artifact-identity.js`.
 */

const CANDIDATE_ARTIFACT_TYPE = 'CANDIDATE';
const DELIVERED_ARTIFACT_TYPE = 'DELIVERED_PAYLOAD';
const CANDIDATE_PHASES = Object.freeze(['CANDIDATE_BUILT', 'CANDIDATE_VALIDATED']);
const DELIVERED_PHASE = 'DELIVERED';

/** Termos que NUNCA podem rotular um candidato (R5). */
const FORBIDDEN_CANDIDATE_LABELS = Object.freeze([
  'DELIVERED',
  'DELIVERED_PAYLOAD',
  'PUBLISHED',
  'PUBLISHED_VERIFIED',
  'FINAL',
  'FINAL_GOVERNANCE',
]);

const IDENTITY_CODES = Object.freeze({
  IDENTITY_MISSING: 'RELEASE_ARTIFACT_IDENTITY_MISSING',
  IDENTITY_INVALID: 'RELEASE_ARTIFACT_IDENTITY_INVALID',
  TYPE_MISMATCH: 'RELEASE_ARTIFACT_TYPE_MISMATCH',
  PHASE_MISMATCH: 'RELEASE_ARTIFACT_PHASE_MISMATCH',
  CANDIDATE_PROMOTED: 'CANDIDATE_PROMOTED_ARTIFICIALLY',
  LINEAGE_CHAIN_BROKEN: 'RELEASE_LINEAGE_CHAIN_BROKEN',
  HASH_MISMATCH: 'RELEASE_ARTIFACT_HASH_MISMATCH',
  FOREIGN_RUN: 'FOREIGN_RUN_ARTIFACT',
  SOURCE_MISMATCH: 'ARTIFACT_SOURCE_MISMATCH',
  HASH_NOT_SHA256: 'RELEASE_ARTIFACT_HASH_NOT_SHA256',
});

const SHA256_RE = /^[a-f0-9]{64}$/i;
const COMMIT_RE = /^[a-f0-9]{40}$/i;

function isSha256(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && COMMIT_RE.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function fail(code, reason, details = {}) {
  return Object.freeze({ valid: false, code, reason, ...details });
}

function pass(details = {}) {
  return Object.freeze({ valid: true, code: null, reason: null, ...details });
}

function missingFields(object, fields) {
  return fields.filter((field) => {
    const value = object?.[field];
    return value == null || value === '';
  });
}

const REQUIRED_CANDIDATE_FIELDS = Object.freeze([
  'artifactType',
  'releasePhase',
  'release',
  'candidateHash',
  'sourceCommit',
  'sourceFingerprint',
  'governanceRunId',
  'createdAt',
]);

const REQUIRED_DELIVERED_FIELDS = Object.freeze([
  'artifactType',
  'releasePhase',
  'release',
  'sourceCommit',
  'sourceFingerprint',
  'candidateHash',
  'parentCandidateHash',
  'finalPayloadHash',
  'governanceRunId',
  'createdAt',
]);

/** Candidato: tipo/fase corretos, hash sha256, nunca rotulado como entregue. */
function validateCandidateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail(IDENTITY_CODES.IDENTITY_MISSING, 'manifesto do candidato ausente ou inválido');
  }
  const missing = missingFields(manifest, REQUIRED_CANDIDATE_FIELDS);
  if (missing.length > 0) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, `campos obrigatórios ausentes: ${missing.join(', ')}`, { missing });
  }
  if (manifest.artifactType !== CANDIDATE_ARTIFACT_TYPE) {
    if (FORBIDDEN_CANDIDATE_LABELS.includes(String(manifest.artifactType))) {
      return fail(
        IDENTITY_CODES.CANDIDATE_PROMOTED,
        `candidato rotulado como ${manifest.artifactType}: promoção artificial`,
      );
    }
    return fail(
      IDENTITY_CODES.TYPE_MISMATCH,
      `artifactType do candidato deve ser ${CANDIDATE_ARTIFACT_TYPE}, recebido ${manifest.artifactType}`,
    );
  }
  if (!CANDIDATE_PHASES.includes(manifest.releasePhase)) {
    return fail(
      IDENTITY_CODES.PHASE_MISMATCH,
      `releasePhase do candidato deve ser uma de ${CANDIDATE_PHASES.join('|')}, recebido ${manifest.releasePhase}`,
    );
  }
  if (!isSha256(manifest.candidateHash)) {
    return fail(IDENTITY_CODES.HASH_NOT_SHA256, 'candidateHash não é SHA-256 completo');
  }
  if (!isCommit(manifest.sourceCommit)) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, 'sourceCommit não é um SHA-1 de 40 caracteres');
  }
  if (!isSha256(manifest.sourceFingerprint)) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, 'sourceFingerprint não é SHA-256 completo');
  }
  if (!isIsoTimestamp(manifest.createdAt)) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, 'createdAt não é um timestamp ISO válido');
  }
  return pass({ release: manifest.release, candidateHash: manifest.candidateHash });
}

/** Payload entregue: identidade completa + lineage. */
function validateDeliveredManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail(IDENTITY_CODES.IDENTITY_MISSING, 'identidade do payload entregue ausente');
  }
  const missing = missingFields(manifest, REQUIRED_DELIVERED_FIELDS);
  if (missing.length > 0) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, `campos obrigatórios ausentes: ${missing.join(', ')}`, { missing });
  }
  if (manifest.artifactType !== DELIVERED_ARTIFACT_TYPE) {
    return fail(
      IDENTITY_CODES.TYPE_MISMATCH,
      `artifactType do payload entregue deve ser ${DELIVERED_ARTIFACT_TYPE}, recebido ${manifest.artifactType}`,
    );
  }
  if (manifest.releasePhase !== DELIVERED_PHASE) {
    return fail(
      IDENTITY_CODES.PHASE_MISMATCH,
      `releasePhase do payload entregue deve ser ${DELIVERED_PHASE}, recebido ${manifest.releasePhase}`,
    );
  }
  for (const field of ['candidateHash', 'parentCandidateHash', 'finalPayloadHash', 'sourceFingerprint']) {
    if (!isSha256(manifest[field])) {
      return fail(IDENTITY_CODES.HASH_NOT_SHA256, `${field} não é SHA-256 completo`);
    }
  }
  if (!isCommit(manifest.sourceCommit)) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, 'sourceCommit não é um SHA-1 de 40 caracteres');
  }
  if (!isIsoTimestamp(manifest.createdAt)) {
    return fail(IDENTITY_CODES.IDENTITY_INVALID, 'createdAt não é um timestamp ISO válido');
  }
  return pass({ release: manifest.release, finalPayloadHash: manifest.finalPayloadHash });
}

/**
 * Cadeia criptográfica (R7/R23/R34/R35): o entregue deriva do candidato do
 * MESMO run e da MESMA fonte. Qualquer divergência quebra a cadeia.
 */
function validateLineageChain({ candidate, delivered } = {}) {
  const candidateValidation = validateCandidateManifest(candidate);
  if (!candidateValidation.valid) return candidateValidation;
  const deliveredValidation = validateDeliveredManifest(delivered);
  if (!deliveredValidation.valid) return deliveredValidation;

  if (delivered.parentCandidateHash !== candidate.candidateHash
    || delivered.candidateHash !== candidate.candidateHash) {
    return fail(
      IDENTITY_CODES.LINEAGE_CHAIN_BROKEN,
      `parentCandidateHash (${delivered.parentCandidateHash}) difere do candidateHash (${candidate.candidateHash})`,
      { parentCandidateHash: delivered.parentCandidateHash, candidateHash: candidate.candidateHash },
    );
  }
  if (delivered.sourceCommit !== candidate.sourceCommit) {
    return fail(
      IDENTITY_CODES.SOURCE_MISMATCH,
      `sourceCommit do entregue (${delivered.sourceCommit}) difere do candidato (${candidate.sourceCommit})`,
    );
  }
  if (delivered.sourceFingerprint !== candidate.sourceFingerprint) {
    return fail(
      IDENTITY_CODES.SOURCE_MISMATCH,
      'sourceFingerprint do entregue difere do candidato',
    );
  }
  if (delivered.governanceRunId !== candidate.governanceRunId) {
    return fail(
      IDENTITY_CODES.FOREIGN_RUN,
      `governanceRunId do entregue (${delivered.governanceRunId}) difere do candidato (${candidate.governanceRunId})`,
    );
  }
  return pass({
    release: delivered.release,
    chain: [
      'SOURCE_FINGERPRINT',
      'CANDIDATE_HASH',
      'FINAL_PAYLOAD_HASH',
      'PACKAGE_MANIFEST',
      'SIGNATURE',
      'PUBLICATION',
    ],
  });
}

/** O hash declarado corresponde aos bytes reais do artefato? (G6/C4) */
function validateArtifactHashBinding({ manifest, field, actualHash, artifactLabel } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    return fail(IDENTITY_CODES.IDENTITY_MISSING, `manifesto ausente para ${artifactLabel || 'artefato'}`);
  }
  const declared = manifest[field];
  if (!isSha256(declared)) {
    return fail(IDENTITY_CODES.HASH_NOT_SHA256, `${field} ausente/inválido em ${artifactLabel || 'artefato'}`);
  }
  if (!isSha256(actualHash)) {
    return fail(IDENTITY_CODES.HASH_NOT_SHA256, `hash real de ${artifactLabel || 'artefato'} não é SHA-256`);
  }
  if (String(declared).toLowerCase() !== String(actualHash).toLowerCase()) {
    return fail(
      IDENTITY_CODES.HASH_MISMATCH,
      `${artifactLabel || 'artefato'}: ${field} declarado (${String(declared).slice(0, 16)}…) difere dos bytes reais (${String(actualHash).slice(0, 16)}…)`,
      { declared, actual: actualHash },
    );
  }
  return pass({ field, hash: actualHash });
}

/**
 * Isolamento por run (R29/R36): artefato de OUTRO run não pode compor o
 * resultado atual, mesmo que seja estruturalmente válido.
 */
function validateRunIsolation({ candidate, delivered, currentRun } = {}) {
  if (!currentRun || !currentRun.runId) {
    return fail(IDENTITY_CODES.IDENTITY_MISSING, 'run corrente não resolvido (governance/.current-run.json)');
  }
  for (const [label, manifest] of [['candidate', candidate], ['delivered', delivered]]) {
    if (!manifest) continue;
    if (manifest.governanceRunId !== currentRun.runId) {
      return fail(
        IDENTITY_CODES.FOREIGN_RUN,
        `${label}.governanceRunId (${manifest.governanceRunId}) != run corrente (${currentRun.runId})`,
        { label, artifactRunId: manifest.governanceRunId, currentRunId: currentRun.runId },
      );
    }
  }
  if (currentRun.sourceFingerprint) {
    for (const [label, manifest] of [['candidate', candidate], ['delivered', delivered]]) {
      if (!manifest) continue;
      if (manifest.sourceFingerprint !== currentRun.sourceFingerprint) {
        return fail(
          IDENTITY_CODES.SOURCE_MISMATCH,
          `${label}.sourceFingerprint difere do run corrente`,
          { label },
        );
      }
    }
  }
  return pass({ runId: currentRun.runId });
}

/** Verificação completa (identidade + cadeia + hashes + isolamento de run). */
function verifyReleaseIdentity({
  candidate,
  delivered,
  candidateActualHash,
  deliveredActualHash,
  currentRun,
} = {}) {
  const checks = [];
  const candidateType = validateCandidateManifest(candidate);
  checks.push({ check: 'candidate_identity', ...candidateType });
  const deliveredType = validateDeliveredManifest(delivered);
  checks.push({ check: 'delivered_identity', ...deliveredType });
  const chain = candidateType.valid && deliveredType.valid
    ? validateLineageChain({ candidate, delivered })
    : fail(IDENTITY_CODES.LINEAGE_CHAIN_BROKEN, 'cadeia não avaliável sem identidades válidas');
  checks.push({ check: 'lineage_chain', ...chain });

  if (candidateActualHash) {
    const binding = validateArtifactHashBinding({
      manifest: candidate,
      field: 'candidateHash',
      actualHash: candidateActualHash,
      artifactLabel: 'candidate.zip',
    });
    checks.push({ check: 'candidate_hash_binding', ...binding });
  }
  if (deliveredActualHash) {
    const binding = validateArtifactHashBinding({
      manifest: delivered,
      field: 'finalPayloadHash',
      actualHash: deliveredActualHash,
      artifactLabel: 'payload.zip',
    });
    checks.push({ check: 'delivered_hash_binding', ...binding });
  }
  if (currentRun) {
    const isolation = validateRunIsolation({ candidate, delivered, currentRun });
    checks.push({ check: 'run_isolation', ...isolation });
  }

  const failed = checks.filter((check) => check.valid === false);
  return Object.freeze({
    valid: failed.length === 0,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
    checks,
    failures: failed,
    code: failed.length > 0 ? failed[0].code : null,
    reason: failed.length > 0 ? failed[0].reason : null,
  });
}

module.exports = {
  CANDIDATE_ARTIFACT_TYPE,
  DELIVERED_ARTIFACT_TYPE,
  CANDIDATE_PHASES,
  DELIVERED_PHASE,
  FORBIDDEN_CANDIDATE_LABELS,
  IDENTITY_CODES,
  REQUIRED_CANDIDATE_FIELDS,
  REQUIRED_DELIVERED_FIELDS,
  isSha256,
  isCommit,
  validateCandidateManifest,
  validateDeliveredManifest,
  validateLineageChain,
  validateArtifactHashBinding,
  validateRunIsolation,
  verifyReleaseIdentity,
};

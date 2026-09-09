'use strict';

/**
 * Release Publication — prova de publicação PÓS-tag do release (P3 do seal).
 *
 * A tag Git imutável (scripts/create-release-tag.sh) nasce DEPOIS do payload
 * e da attestation Ed25519 — colocá-la dentro do payload seria circularidade.
 * O receipt de publicação é artefato pós-publicação SEPARADO que referencia os
 * hashes imutáveis do release (envelope, payload, manifest) + commit/tree/tag:
 *
 *   publicationReceipt = { releaseId, envelopeSha256, payloadSha256,
 *     manifestSha256, gitCommit, gitTree, releaseTag, tagTarget }
 *   signature = Ed25519_sign(privateKey, canonicalJSON(publicationReceipt))
 *
 * Domain separation: signaturePurpose='RAP_RELEASE_PUBLICATION_RECEIPT' —
 * uma attestation de release reutilizada como receipt (ou vice-versa) é
 * rejeitada pelo propósito, mesmo com a mesma chave.
 *
 * Chaves: mesmas do release-attestation (loadPrivateKey/loadPublicKey de
 * governance/release-attestation.js) — nunca duplicar key loading.
 */

const crypto = require('crypto');
const {
  ALGORITHM,
  ATTESTATION_VERSION,
  canonicalJson,
  publicKeyFingerprint,
  loadPrivateKey,
  loadPublicKey,
} = require('./release-attestation');

const RECEIPT_ARTIFACT_TYPE = 'release-publication-receipt';
const SIGNATURE_ARTIFACT_TYPE = 'release-publication-signature';
const SIGNATURE_PURPOSE = 'RAP_RELEASE_PUBLICATION_RECEIPT';
const REQUIRED_FIELDS = [
  'releaseId',
  'envelopeSha256',
  'payloadSha256',
  'manifestSha256',
  'gitCommit',
  'gitTree',
  'releaseTag',
  'tagTarget',
];

/**
 * Documento canônico de publicação (campos cobertos pela assinatura).
 */
function buildPublicationDocument(fields) {
  const doc = {};
  for (const key of REQUIRED_FIELDS) {
    if (!fields || fields[key] === undefined || fields[key] === null) {
      throw new Error(`release_publication_field_missing — ${key}`);
    }
    doc[key] = fields[key];
  }
  return doc;
}

/**
 * Assina o receipt de publicação. Retorna o objeto .sig completo.
 */
function signPublicationReceipt(fields) {
  const doc = buildPublicationDocument(fields);
  const canonical = canonicalJson(doc);
  const privateKeyPem = loadPrivateKey();
  const publicKeyPem = loadPublicKey();
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem).toString('hex');
  return {
    artifactType: SIGNATURE_ARTIFACT_TYPE,
    artifactVersion: ATTESTATION_VERSION,
    algorithm: ALGORITHM,
    signaturePurpose: SIGNATURE_PURPOSE,
    signedDocument: 'canonicalJSON(publicationReceipt)',
    receipt: doc,
    canonicalPayload: canonical,
    signature,
    publicKeyFingerprint: publicKeyFingerprint(publicKeyPem),
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verifica um objeto .sig de receipt de publicação contra o receipt informado.
 * @returns {{ok: boolean, reason: string|null}}
 */
function verifyPublicationReceipt(receipt, sigObject, { publicKeyPem = null } = {}) {
  try {
    if (!sigObject || sigObject.algorithm !== ALGORITHM || !sigObject.signature || !sigObject.receipt) {
      return { ok: false, reason: 'SIGNATURE_INVALID — objeto de assinatura de publicação malformado' };
    }
    if (sigObject.signaturePurpose !== SIGNATURE_PURPOSE) {
      return {
        ok: false,
        reason: `SIGNATURE_PURPOSE_MISMATCH — signaturePurpose=${sigObject.signaturePurpose || 'null'}; `
          + 'attestation de release reutilizada como receipt (ou vice-versa) é rejeitada',
      };
    }
    const canonical = canonicalJson(buildPublicationDocument(receipt));
    if (canonical !== sigObject.canonicalPayload) {
      return { ok: false, reason: 'SIGNATURE_INVALID — canonicalPayload diverge do receipt declarado' };
    }
    const pubPem = loadPublicKey(publicKeyPem);
    if (sigObject.publicKeyFingerprint
      && sigObject.publicKeyFingerprint !== publicKeyFingerprint(pubPem)) {
      return { ok: false, reason: 'SIGNATURE_KEY_MISMATCH — publicKeyFingerprint diverge da chave pública de verificação' };
    }
    const valid = crypto.verify(null, Buffer.from(canonical, 'utf8'), pubPem, Buffer.from(sigObject.signature, 'hex'));
    if (!valid) return { ok: false, reason: 'SIGNATURE_INVALID — verificação Ed25519 falhou' };
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: `SIGNATURE_INVALID — ${error.message}` };
  }
}

module.exports = {
  RECEIPT_ARTIFACT_TYPE,
  SIGNATURE_ARTIFACT_TYPE,
  SIGNATURE_PURPOSE,
  REQUIRED_FIELDS,
  buildPublicationDocument,
  signPublicationReceipt,
  verifyPublicationReceipt,
};

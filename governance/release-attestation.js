#!/usr/bin/env node
'use strict';

/**
 * Release Attestation — assinatura Ed25519 do release.
 *
 * Substitui o pseudo-selo sha256(payloadHash:sigName:releaseId) (checksum
 * derivado, forjável por qualquer pessoa) por autenticação real:
 *
 *   canonicalAttestation = canonicalJSON({
 *     releaseId, runId, sourceFingerprint, gitCommit, gitTree,
 *     payloadSha256, manifestSha256, finalDecision
 *   })
 *   signature = Ed25519_sign(privateKey, canonicalAttestation)
 *
 * Chaves:
 *   private key — FORA do pacote e FORA do repositório, no runtime root
 *                 (~/.local/share/ragent2-runtime/release-keys/ em dev,
 *                  /var/lib/ragent2/release-keys/ em produção), modo 0600,
 *                 ou via env RAP_RELEASE_ATTESTATION_PRIVATE_KEY (PEM ou
 *                 PEM base64 — canal de secret store/CI).
 *   public key  — distribuível; versionada em governance/release-attestation-public-key.json
 *                 e copiada para dist/verifier/ no envelope; override via env
 *                 RAP_RELEASE_ATTESTATION_PUBLIC_KEY (mesmo formato).
 *
 * Modificar qualquer campo coberto invalida a assinatura.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC_KEY_REPO_PATH = path.join(ROOT, 'governance', 'release-attestation-public-key.json');
const ATTESTATION_VERSION = '1.0.0';
const ALGORITHM = 'ed25519';

/** Runtime root segue a mesma política de docs/runtime-paths.md. */
function resolveKeyDir() {
  if (process.env.RAP_RELEASE_KEY_DIR) return process.env.RAP_RELEASE_KEY_DIR;
  const base = process.env.RAP_RUNTIME_ROOT
    || (process.env.NODE_ENV === 'production'
      ? '/var/lib/ragent2'
      : path.join(require('os').homedir(), '.local', 'share', 'ragent2-runtime'));
  return path.join(base, 'release-keys');
}

function privateKeyPath() { return path.join(resolveKeyDir(), 'release-attestation-private.pem'); }
function publicKeyPath() { return path.join(resolveKeyDir(), 'release-attestation-public.pem'); }

/** JSON canônico: chaves ordenadas recursivamente, sem espaços. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** Fingerprint curto da chave pública (identificação, não segredo). */
function publicKeyFingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
}

/**
 * Gera par de chaves Ed25519 no runtime root (0600). Não sobrescreve par
 * existente salvo com {force:true}. Retorna os paths.
 */
function generateKeyPair({ force = false } = {}) {
  const dir = resolveKeyDir();
  const privPath = privateKeyPath();
  const pubPath = publicKeyPath();
  if (!force && fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    return { privateKeyPath: privPath, publicKeyPath: pubPath, created: false };
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(privPath, privPem, { mode: 0o600 });
  fs.writeFileSync(pubPath, pubPem, { mode: 0o644 });
  return { privateKeyPath: privPath, publicKeyPath: pubPath, created: true };
}

/**
 * Exporta a chave pública para o repositório (governance/) — segura para
 * versionar e distribuir no envelope. NUNCA exporta a privada.
 */
function exportPublicKeyToRepo() {
  const pubPath = publicKeyPath();
  if (!fs.existsSync(pubPath)) {
    throw new Error('release_attestation_key_missing — rode release-attestation.js keygen primeiro');
  }
  const pubPem = fs.readFileSync(pubPath, 'utf8');
  const payload = {
    artifactType: 'release-attestation-public-key',
    artifactVersion: ATTESTATION_VERSION,
    algorithm: ALGORITHM,
    publicKey: pubPem,
    publicKeyFingerprint: publicKeyFingerprint(pubPem),
    exportedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PUBLIC_KEY_REPO_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/** Decodifica chave vinda de env: aceita PEM cru ou PEM em base64. */
function decodeEnvKey(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('-----BEGIN')) return `${trimmed}\n`;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (decoded.startsWith('-----BEGIN')) return `${decoded}\n`;
  } catch { /* não é base64 válido */ }
  throw new Error('release_attestation_env_key_invalid — env não contém PEM nem PEM base64');
}

function loadPrivateKey() {
  const fromEnv = decodeEnvKey(process.env.RAP_RELEASE_ATTESTATION_PRIVATE_KEY);
  if (fromEnv) return fromEnv;
  const privPath = privateKeyPath();
  if (!fs.existsSync(privPath)) {
    throw new Error(`release_attestation_key_missing — chave privada ausente em ${privPath}; fora do pacote por design`);
  }
  return fs.readFileSync(privPath, 'utf8');
}

function loadPublicKey(explicitPem = null) {
  if (explicitPem) return explicitPem;
  const fromEnv = decodeEnvKey(process.env.RAP_RELEASE_ATTESTATION_PUBLIC_KEY);
  if (fromEnv) return fromEnv;
  // Prioridade: chave pública do MESMO keyDir da privada (garante que o
  // fingerprint embutido na assinatura é da chave que assinou); fallback para
  // a cópia versionada no repo (lado de verificação offline).
  const pubPath = publicKeyPath();
  if (fs.existsSync(pubPath)) return fs.readFileSync(pubPath, 'utf8');
  if (fs.existsSync(PUBLIC_KEY_REPO_PATH)) {
    const data = JSON.parse(fs.readFileSync(PUBLIC_KEY_REPO_PATH, 'utf8'));
    if (data && data.publicKey) return data.publicKey;
  }
  throw new Error('release_attestation_public_key_missing');
}

/**
 * Monta o documento canônico de atestação (campos cobertos pela assinatura).
 */
function buildAttestationDocument(fields) {
  const required = ['releaseId', 'runId', 'sourceFingerprint', 'gitCommit', 'gitTree', 'payloadSha256', 'manifestSha256', 'finalDecision'];
  const doc = {};
  for (const key of required) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`release_attestation_field_missing — ${key} é obrigatório no atestado`);
    }
    doc[key] = fields[key];
  }
  return doc;
}

/**
 * Assina o atestado do release. Retorna o objeto .sig completo.
 */
function signAttestation(fields) {
  const doc = buildAttestationDocument(fields);
  const canonical = canonicalJson(doc);
  const privateKeyPem = loadPrivateKey();
  const publicKeyPem = loadPublicKey();
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem).toString('hex');
  return {
    artifactType: 'release-attestation-signature',
    artifactVersion: ATTESTATION_VERSION,
    algorithm: ALGORITHM,
    signedDocument: 'canonicalJSON(attestation)',
    attestation: doc,
    canonicalPayload: canonical,
    signature,
    publicKeyFingerprint: publicKeyFingerprint(publicKeyPem),
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verifica um objeto .sig de atestado.
 * @returns {{ok: boolean, reason: string|null}}
 */
function verifyAttestation(sigObject, { publicKeyPem = null } = {}) {
  try {
    if (!sigObject || sigObject.algorithm !== ALGORITHM || !sigObject.signature || !sigObject.attestation) {
      return { ok: false, reason: 'SIGNATURE_INVALID — objeto de atestado malformado' };
    }
    const canonical = canonicalJson(buildAttestationDocument(sigObject.attestation));
    if (canonical !== sigObject.canonicalPayload) {
      return { ok: false, reason: 'SIGNATURE_INVALID — canonicalPayload diverge do atestado declarado' };
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

/**
 * Exporta a chave pública RESOLVIDA (env > keyDir > repo) para um path
 * arbitrário — usado pelo pipeline para embutir a pública correta no envelope
 * (dist/verifier/), mesmo quando a chave veio de secret store/CI.
 */
function exportResolvedPublicKey(targetPath) {
  const pubPem = loadPublicKey();
  const payload = {
    artifactType: 'release-attestation-public-key',
    artifactVersion: ATTESTATION_VERSION,
    algorithm: ALGORITHM,
    publicKey: pubPem,
    publicKeyFingerprint: publicKeyFingerprint(pubPem),
    exportedAt: new Date().toISOString(),
  };
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'keygen') {
      const result = generateKeyPair({ force: process.argv.includes('--force') });
      // --no-repo-export: CI/efêmero — não tocar no worktree (gate DIRTY_WORKTREE).
      if (process.argv.includes('--no-repo-export')) {
        const pubPem = fs.readFileSync(result.publicKeyPath, 'utf8');
        console.log(JSON.stringify({ ...result, publicKeyFingerprint: publicKeyFingerprint(pubPem) }));
      } else {
        const exported = exportPublicKeyToRepo();
        console.log(JSON.stringify({
          ...result,
          publicKeyFingerprint: exported.publicKeyFingerprint,
          repoPublicKey: path.relative(ROOT, PUBLIC_KEY_REPO_PATH),
        }));
      }
    } else if (cmd === 'export-public-key') {
      console.log(JSON.stringify(exportPublicKeyToRepo()));
    } else {
      console.error('uso: release-attestation.js keygen [--force] [--no-repo-export] | export-public-key');
      process.exit(1);
    }
  } catch (error) {
    console.error(`[release-attestation] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  ALGORITHM,
  ATTESTATION_VERSION,
  PUBLIC_KEY_REPO_PATH,
  canonicalJson,
  publicKeyFingerprint,
  generateKeyPair,
  exportPublicKeyToRepo,
  exportResolvedPublicKey,
  buildAttestationDocument,
  signAttestation,
  verifyAttestation,
  loadPrivateKey,
  loadPublicKey,
  resolveKeyDir,
};

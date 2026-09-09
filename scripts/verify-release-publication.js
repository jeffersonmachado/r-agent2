#!/usr/bin/env node
'use strict';

/**
 * verify-release-publication.js — verificador standalone do receipt de
 * publicação pós-tag (artefato gerado por
 * scripts/governance/create-release-publication-receipt.js).
 *
 * OFFLINE-FIRST: o modo default não consulta rede nem exige repo git —
 * apenas stdlib + o módulo local governance/release-publication.js. Checks:
 *
 *   1. artefatos do release existem (envelope/payload/manifest);
 *   2. sha256 real dos artefatos == campos do receipt
 *      (PUBLICATION_RECEIPT_HASH_MISMATCH);
 *   3. gitCommit/gitTree/releaseTag/tagTarget presentes; tagMatches === true e
 *      tagTarget === gitCommit (RELEASE_TAG_TARGET_CHANGED);
 *   4. assinatura Ed25519 válida (domain separation
 *      RAP_RELEASE_PUBLICATION_RECEIPT) com a chave pública fornecida
 *      (PUBLICATION_RECEIPT_SIGNATURE_INVALID);
 *   5. status === 'PUBLISHED_VERIFIED' (PUBLICATION_RECEIPT_STATUS_INVALID).
 *
 * Com --online: adicionalmente confirma via `git ls-remote origin
 * refs/tags/<tag>` que a tag remota ainda aponta para tagTarget; se mudou →
 * FAIL RELEASE_TAG_TARGET_CHANGED. Sem --online, nenhuma consulta de rede.
 *
 * Uso:
 *   node scripts/verify-release-publication.js --release <id>
 *     [--receipt <path>] [--signature <path>] [--public-key <path>]
 *     [--release-dir <dir>] [--online]
 * Exit 0 = PASS; Exit 1 = falhas listadas.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { verifyPublicationReceipt } = require('../governance/release-publication');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_RELEASE_DIR = path.join(ROOT_DIR, 'dist', 'release');
const DEFAULT_RECEIPT_PATH = path.join(ROOT_DIR, 'governance', 'release-publication-receipt.json');
const DEFAULT_SIGNATURE_PATH = path.join(ROOT_DIR, 'governance', 'release-publication-receipt.sig');
const DEFAULT_PUBLIC_KEY_PATHS = [
  path.join(ROOT_DIR, 'dist', 'verifier', 'release-attestation-public-key.json'),
  path.join(ROOT_DIR, 'governance', 'release-attestation-public-key.json'),
];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Aceita JSON {publicKey: pem} (shape release-attestation-public-key) ou PEM cru. */
function loadPublicKeyPem(publicKeyPath) {
  const raw = fs.readFileSync(publicKeyPath, 'utf8');
  if (raw.trim().startsWith('-----BEGIN')) return raw;
  const data = JSON.parse(raw);
  if (!data || typeof data.publicKey !== 'string') {
    throw new Error(`chave pública ilegível em ${publicKeyPath} — esperado PEM ou JSON com campo publicKey`);
  }
  return data.publicKey;
}

function resolvePublicKeyPath(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  for (const candidate of DEFAULT_PUBLIC_KEY_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseCliArgs(argv) {
  const options = { online: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') { options.release = argv[index + 1]; index += 1; }
    else if (arg === '--receipt') { options.receiptPath = argv[index + 1]; index += 1; }
    else if (arg === '--signature') { options.signaturePath = argv[index + 1]; index += 1; }
    else if (arg === '--public-key') { options.publicKeyPath = argv[index + 1]; index += 1; }
    else if (arg === '--release-dir') { options.releaseDir = argv[index + 1]; index += 1; }
    else if (arg === '--remote') { options.remote = argv[index + 1]; index += 1; }
    else if (arg === '--online') { options.online = true; }
  }
  return options;
}

/**
 * Resolve o target da tag remota a partir da saída de `git ls-remote`
 * (deref ^{} tem prioridade sobre o objeto da tag anotada).
 */
function resolveRemoteTagTarget(lsRemoteOutput, tag) {
  let target = null;
  for (const line of String(lsRemoteOutput || '').split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/tags/${tag}^{}`) target = sha;
    else if (ref === `refs/tags/${tag}` && !target) target = sha;
  }
  return target;
}

function defaultLsRemote(remote, tag) {
  return execFileSync('git', ['ls-remote', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Verificação completa. Função testável: lsRemoteRunner injetável para o modo
 * online ((remote, tag) => stdout de ls-remote, lança em falha).
 *
 * @param {object} options { release, receiptPath, signaturePath, publicKeyPath,
 *   releaseDir, online, remote }
 * @param {object} [deps] { lsRemoteRunner }
 * @returns {{ok: boolean, checks: Array<{code: string, ok: boolean, detail: string|null}>}}
 */
function verifyReleasePublication(options, deps = {}) {
  const checks = [];
  const pass = (code, detail = null) => checks.push({ code, ok: true, detail });
  const fail = (code, detail) => checks.push({ code, ok: false, detail });

  const release = options.release;
  if (!release) {
    fail('PUBLICATION_RELEASE_ARG_MISSING', '--release é obrigatório');
    return { ok: false, checks };
  }
  const releaseDir = path.resolve(options.releaseDir || DEFAULT_RELEASE_DIR);
  const artifacts = {
    envelopeSha256: { file: path.join(releaseDir, `${release}.zip`), label: 'envelope' },
    payloadSha256: { file: path.join(releaseDir, `${release}.payload.zip`), label: 'payload' },
    manifestSha256: { file: path.join(releaseDir, `${release}.manifest.json`), label: 'manifest' },
  };
  for (const { file, label } of Object.values(artifacts)) {
    if (!fs.existsSync(file)) {
      fail('PUBLICATION_ARTIFACT_MISSING', `${label} ausente: ${file}`);
    }
  }
  if (checks.some((c) => !c.ok)) return { ok: false, checks };

  const receiptPath = path.resolve(options.receiptPath || DEFAULT_RECEIPT_PATH);
  const signaturePath = path.resolve(options.signaturePath || DEFAULT_SIGNATURE_PATH);
  if (!fs.existsSync(receiptPath)) {
    fail('PUBLICATION_RECEIPT_MISSING', `receipt ausente: ${receiptPath}`);
    return { ok: false, checks };
  }
  if (!fs.existsSync(signaturePath)) {
    fail('PUBLICATION_SIGNATURE_MISSING', `assinatura ausente: ${signaturePath}`);
    return { ok: false, checks };
  }
  const receipt = readJson(receiptPath);
  const sig = readJson(signaturePath);
  if (!receipt) {
    fail('PUBLICATION_RECEIPT_MISSING', `receipt ilegível: ${receiptPath}`);
    return { ok: false, checks };
  }
  if (!sig) {
    fail('PUBLICATION_SIGNATURE_MISSING', `assinatura ilegível: ${signaturePath}`);
    return { ok: false, checks };
  }

  if (receipt.releaseId !== release) {
    fail('PUBLICATION_RECEIPT_RELEASE_MISMATCH', `receipt.releaseId=${receipt.releaseId} != --release ${release}`);
  } else {
    pass('PUBLICATION_RECEIPT_RELEASE_MATCH');
  }

  // Hashes reais dos artefatos == campos do receipt.
  for (const [field, { file, label }] of Object.entries(artifacts)) {
    const actual = sha256File(file);
    if (receipt[field] !== actual) {
      fail('PUBLICATION_RECEIPT_HASH_MISMATCH',
        `${label}: receipt=${String(receipt[field] || 'null').slice(0, 12)} != real=${actual.slice(0, 12)}`);
    } else {
      pass(`PUBLICATION_HASH_${label.toUpperCase()}`);
    }
  }

  // Campos git/tag: presentes, tagMatches === true, tagTarget === gitCommit.
  const requiredGitFields = ['gitCommit', 'gitTree', 'releaseTag', 'tagTarget'];
  const missing = requiredGitFields.filter((field) => !receipt[field]);
  if (missing.length > 0) {
    fail('PUBLICATION_RECEIPT_FIELD_MISSING', `campos ausentes: ${missing.join(', ')}`);
  } else if (receipt.tagMatches !== true || receipt.tagTarget !== receipt.gitCommit) {
    fail('RELEASE_TAG_TARGET_CHANGED',
      `tagMatches=${receipt.tagMatches} tagTarget=${receipt.tagTarget} gitCommit=${receipt.gitCommit}`);
  } else {
    pass('RELEASE_TAG_TARGET_STABLE');
  }

  if (receipt.status !== 'PUBLISHED_VERIFIED') {
    fail('PUBLICATION_RECEIPT_STATUS_INVALID', `status=${receipt.status || 'null'}`);
  } else {
    pass('PUBLICATION_RECEIPT_STATUS');
  }

  // Assinatura Ed25519 com domain separation.
  const publicKeyPath = resolvePublicKeyPath(options.publicKeyPath);
  if (!publicKeyPath || !fs.existsSync(publicKeyPath)) {
    fail('PUBLICATION_PUBLIC_KEY_MISSING', 'chave pública de verificação não encontrada (--public-key)');
  } else {
    let publicKeyPem = null;
    try {
      publicKeyPem = loadPublicKeyPem(publicKeyPath);
    } catch (error) {
      fail('PUBLICATION_PUBLIC_KEY_MISSING', error.message);
    }
    if (publicKeyPem) {
      const sigResult = verifyPublicationReceipt(receipt, sig, { publicKeyPem });
      if (!sigResult.ok) {
        fail('PUBLICATION_RECEIPT_SIGNATURE_INVALID', sigResult.reason);
      } else {
        pass('PUBLICATION_RECEIPT_SIGNATURE');
      }
    }
  }

  // --online: tag remota ainda aponta para tagTarget.
  if (options.online && receipt.releaseTag && receipt.tagTarget) {
    const remote = options.remote || 'origin';
    const runner = deps.lsRemoteRunner || defaultLsRemote;
    try {
      const output = runner(remote, receipt.releaseTag);
      const remoteTarget = resolveRemoteTagTarget(output, receipt.releaseTag);
      if (!remoteTarget) {
        fail('RELEASE_TAG_TARGET_CHANGED', `tag ${receipt.releaseTag} inexistente no remote ${remote}`);
      } else if (remoteTarget !== receipt.tagTarget) {
        fail('RELEASE_TAG_TARGET_CHANGED',
          `tag remota ${receipt.releaseTag} aponta para ${remoteTarget} != tagTarget do receipt ${receipt.tagTarget}`);
      } else {
        pass('RELEASE_TAG_REMOTE_CONFIRMED');
      }
    } catch (error) {
      fail('RELEASE_TAG_REMOTE_UNREACHABLE', `git ls-remote falhou — ${error.message}`);
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

function main(argv) {
  const options = parseCliArgs(argv);
  const { ok, checks } = verifyReleasePublication(options);
  for (const check of checks) {
    // eslint-disable-next-line no-console
    console.log(`[verify-release-publication] ${check.ok ? 'PASS' : 'FAIL'} ${check.code}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[verify-release-publication] ${ok ? 'PASS' : 'FAIL'} release=${options.release || 'null'} online=${options.online === true}`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  parseCliArgs,
  resolveRemoteTagTarget,
  verifyReleasePublication,
};

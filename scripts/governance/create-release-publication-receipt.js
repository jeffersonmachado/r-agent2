#!/usr/bin/env node
'use strict';

/**
 * create-release-publication-receipt.js — prova de publicação PÓS-tag (P3).
 *
 * Roda DEPOIS de scripts/create-release-tag.sh: o pacote (envelope + payload +
 * manifest) e a attestation já existem; a tag Git imutável aponta para o commit
 * do manifest. Este script gera artefatos SEPARADOS (nunca reempacota o
 * payload — a tag não entra no pacote, circularidade proibida):
 *
 *   governance/release-publication-receipt.json — receipt com os hashes reais
 *     dos artefatos + commit/tree/tag + checks de proveniência remota.
 *   governance/release-publication-receipt.sig — assinatura Ed25519 do
 *     canonicalJSON do receipt (domain separation: RAP_RELEASE_PUBLICATION_RECEIPT).
 *
 * Verificação offline posterior: scripts/verify-release-publication.js.
 *
 * Uso:
 *   node scripts/governance/create-release-publication-receipt.js
 *     --release r-agent2-YYYYMMDD-HHMMSS --tag <tag> [--skip-remote]
 *     [--release-dir <dir>] [--out-dir <dir>]
 * Exit 0 = receipt PUBLISHED_VERIFIED gerado; Exit 1 = qualquer check falhou
 * (nenhum artefato PUBLISHED_VERIFIED é escrito).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { verifyRemoteProvenance, execGit } = require('./verify-remote-provenance');
const {
  RECEIPT_ARTIFACT_TYPE,
  signPublicationReceipt,
} = require('../../governance/release-publication');

const ROOT_DIR = path.join(__dirname, '..', '..');
const RECEIPT_VERSION = '1.0.0';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseCliArgs(argv) {
  const options = { skipRemote: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') { options.release = argv[index + 1]; index += 1; }
    else if (arg === '--tag') { options.tag = argv[index + 1]; index += 1; }
    else if (arg === '--release-dir') { options.releaseDir = argv[index + 1]; index += 1; }
    else if (arg === '--out-dir') { options.outDir = argv[index + 1]; index += 1; }
    else if (arg === '--skip-remote') { options.skipRemote = true; }
  }
  return options;
}

/**
 * Monta (e opcionalmente assina/grava) o receipt de publicação.
 * Função testável: gitRunner injetável ((args) => stdout, contrato de execGit).
 *
 * @param {object} options { release, tag, releaseDir, outDir, skipRemote }
 * @param {object} [deps] { gitRunner }
 * @returns {{receipt: object, sig: object, paths: object}}
 */
function createPublicationReceipt(options, deps = {}) {
  const release = options.release;
  const tag = options.tag;
  if (!release) throw new Error('release_publication_field_missing — --release é obrigatório');
  if (!tag) throw new Error('release_publication_field_missing — --tag é obrigatório');

  const releaseDir = path.resolve(options.releaseDir || path.join(ROOT_DIR, 'dist', 'release'));
  const envelopePath = path.join(releaseDir, `${release}.zip`);
  const payloadPath = path.join(releaseDir, `${release}.payload.zip`);
  const manifestPath = path.join(releaseDir, `${release}.manifest.json`);
  for (const artifactPath of [envelopePath, payloadPath, manifestPath]) {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`release_publication_artifact_missing — ${path.relative(ROOT_DIR, artifactPath)}`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const gitCommit = manifest.git_commit || manifest.gitCommit || null;
  const gitTree = manifest.git_tree || manifest.gitTree || null;
  if (!gitCommit || !gitTree) {
    throw new Error('release_publication_field_missing — manifest sem git_commit/git_tree');
  }

  const gitRunner = deps.gitRunner || ((args) => execGit(args, ROOT_DIR));
  const tagTarget = gitRunner(['rev-parse', `${tag}^{commit}`]);
  const tagMatches = tagTarget === gitCommit;
  if (!tagMatches) {
    throw new Error(`RELEASE_TAG_TARGET_CHANGED — tag ${tag} aponta para ${tagTarget} != commit do release ${gitCommit}`);
  }

  let remoteCommitExists = null;
  let remoteTreeMatches = null;
  if (!options.skipRemote) {
    const provenance = verifyRemoteProvenance(
      { manifestPath, tag, requireTag: true },
      gitRunner,
    );
    remoteCommitExists = provenance.commitExists === true;
    remoteTreeMatches = provenance.treeMatches === true;
    if (provenance.status !== 'PASS') {
      throw new Error(`REMOTE_PROVENANCE_${provenance.failureCode || 'FAIL'} — ${provenance.detail || 'proveniência remota reprovou'}`);
    }
  }

  const receipt = {
    artifactType: RECEIPT_ARTIFACT_TYPE,
    artifactVersion: RECEIPT_VERSION,
    generatedAt: new Date().toISOString(),
    releaseId: release,
    envelopeSha256: sha256File(envelopePath),
    payloadSha256: sha256File(payloadPath),
    manifestSha256: sha256File(manifestPath),
    gitCommit,
    gitTree,
    releaseTag: tag,
    tagTarget,
    tagMatches,
    remoteCommitExists,
    remoteTreeMatches,
    status: 'PUBLISHED_VERIFIED',
  };

  const sig = signPublicationReceipt({
    releaseId: receipt.releaseId,
    envelopeSha256: receipt.envelopeSha256,
    payloadSha256: receipt.payloadSha256,
    manifestSha256: receipt.manifestSha256,
    gitCommit: receipt.gitCommit,
    gitTree: receipt.gitTree,
    releaseTag: receipt.releaseTag,
    tagTarget: receipt.tagTarget,
  });

  const outDir = path.resolve(options.outDir || path.join(ROOT_DIR, 'governance'));
  fs.mkdirSync(outDir, { recursive: true });
  const receiptPath = path.join(outDir, 'release-publication-receipt.json');
  const sigPath = path.join(outDir, 'release-publication-receipt.sig');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(sigPath, `${JSON.stringify(sig, null, 2)}\n`);
  return { receipt, sig, paths: { receiptPath, sigPath } };
}

function main(argv) {
  const options = parseCliArgs(argv);
  try {
    const { receipt, paths } = createPublicationReceipt(options);
    // eslint-disable-next-line no-console
    console.log(`[release-publication] status=${receipt.status} release=${receipt.releaseId}`
      + ` tag=${receipt.releaseTag} tagTarget=${receipt.tagTarget}`
      + ` remoteCommitExists=${receipt.remoteCommitExists} remoteTreeMatches=${receipt.remoteTreeMatches}`);
    // eslint-disable-next-line no-console
    console.log(`[release-publication] receipt: ${path.relative(ROOT_DIR, paths.receiptPath)}`);
    // eslint-disable-next-line no-console
    console.log(`[release-publication] assinatura: ${path.relative(ROOT_DIR, paths.sigPath)}`);
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[release-publication] FAIL ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  RECEIPT_VERSION,
  parseCliArgs,
  createPublicationReceipt,
};

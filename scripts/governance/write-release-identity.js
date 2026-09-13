#!/usr/bin/env node
'use strict';

/**
 * write-release-identity.js — materializa a IDENTIDADE dos artefatos de release
 * (candidato, validação do candidato e payload entregue) sem inventar nada: os
 * hashes vêm dos BYTES reais e o lineage vem do manifesto/run gerados pelo
 * pipeline.
 *
 * Uso (chamado pelo scripts/two-pass-release.sh):
 *   node scripts/governance/write-release-identity.js --kind candidate \
 *     --release <nome> --candidate-hash <sha256> --commit <sha> [--phase CANDIDATE_BUILT]
 *
 *   node scripts/governance/write-release-identity.js --kind candidate-validation \
 *     --release <nome> --candidate-hash <sha256>
 *
 *   node scripts/governance/write-release-identity.js --kind delivered \
 *     --release <nome> --candidate-hash <sha256> --payload-hash <sha256>
 *
 * O `--kind delivered` lê runId/sourceFingerprint/git_commit do manifesto final
 * (fonte canônica do pipeline) e nunca recalcula hash de ZIP: o chamador passa o
 * hash dos bytes que ele mesmo escreveu.
 */

const fs = require('fs');
const path = require('path');

const {
  CANDIDATE_ARTIFACT_TYPE,
  DELIVERED_ARTIFACT_TYPE,
  CANDIDATE_PHASES,
} = require('../../governance/release-artifact-identity');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_DIR = path.join(ROOT, 'dist', 'candidate');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  return out;
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function currentRun() {
  const ctx = readJsonSafe(path.join(ROOT, 'governance', '.current-run.json'));
  return ctx && ctx.runId ? ctx : null;
}

function fail(message) {
  console.error(`[release-identity] FALHA: ${message}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind;
  const release = args.release;
  if (!kind) fail('--kind é obrigatório (candidate|candidate-validation|delivered)');
  if (!release) fail('--release é obrigatório');

  const run = currentRun();
  if (!run) fail('governance/.current-run.json ausente — identidade não pode ser criada sem run governado');
  const createdAt = new Date().toISOString();

  if (kind === 'candidate') {
    const candidateHash = args['candidate-hash'];
    if (!candidateHash) fail('--candidate-hash é obrigatório');
    const phase = args.phase || 'CANDIDATE_BUILT';
    if (!CANDIDATE_PHASES.includes(phase)) fail(`--phase inválida para candidato: ${phase}`);
    const manifest = {
      artifactType: CANDIDATE_ARTIFACT_TYPE,
      releasePhase: phase,
      release,
      candidateHash,
      sourceCommit: args.commit || null,
      sourceFingerprint: run.sourceFingerprint,
      governanceRunId: run.runId,
      createdAt,
      artifact: `${release}.candidate.zip`,
      canonicalPath: `dist/candidate/${release}.candidate.zip`,
      producedBy: 'scripts/two-pass-release.sh#pass1',
      note: 'Candidato é artefato de primeira classe; nunca rotulado DELIVERED/PUBLISHED/FINAL.',
    };
    const target = path.join(CANDIDATE_DIR, `${release}.candidate.manifest.json`);
    writeJson(target, manifest);
    console.log(`[release-identity] candidato identificado: ${path.relative(ROOT, target)} hash=${candidateHash.slice(0, 16)}…`);
    return;
  }

  if (kind === 'candidate-validation') {
    const candidateHash = args['candidate-hash'];
    if (!candidateHash) fail('--candidate-hash é obrigatório');
    const report = readJsonSafe(path.join(ROOT, 'governance', 'package-validation-report.json')) || {};
    const integrity = readJsonSafe(path.join(ROOT, 'governance', 'package-integrity-report.json')) || {};
    const tamper = readJsonSafe(path.join(ROOT, 'governance', 'tamper-detection-report.json')) || {};
    const selfProving = readJsonSafe(path.join(ROOT, 'governance', 'self-proving-report.json')) || {};
    const validation = {
      artifactType: 'CANDIDATE_VALIDATION',
      releasePhase: 'CANDIDATE_VALIDATED',
      release,
      candidateHash,
      sourceFingerprint: run.sourceFingerprint,
      governanceRunId: run.runId,
      createdAt,
      gates: [
        { id: 'candidate_package_validation', status: report.status || 'UNKNOWN', source: 'governance/package-validation-report.json' },
        { id: 'candidate_package_integrity', status: integrity.status || 'UNKNOWN', source: 'governance/package-integrity-report.json' },
        { id: 'candidate_tamper_detection', status: tamper.status || tamper.decision || 'UNKNOWN', source: 'governance/tamper-detection-report.json' },
        { id: 'candidate_self_proof', status: selfProving.status || (selfProving.pass === true ? 'PASS' : 'UNKNOWN'), source: 'governance/self-proving-report.json' },
      ],
      note: 'Relatório de validação do candidato. Não altera os bytes do candidato (R23).',
    };
    const target = path.join(CANDIDATE_DIR, `${release}.candidate-validation.json`);
    writeJson(target, validation);
    console.log(`[release-identity] validação do candidato registrada: ${path.relative(ROOT, target)}`);
    return;
  }

  if (kind === 'delivered') {
    const candidateHash = args['candidate-hash'];
    const payloadHash = args['payload-hash'];
    if (!candidateHash) fail('--candidate-hash é obrigatório');
    if (!payloadHash) fail('--payload-hash é obrigatório');
    const manifestPath = path.join(RELEASE_DIR, `${release}.manifest.json`);
    const manifest = readJsonSafe(manifestPath);
    if (!manifest) fail(`manifesto final ausente: dist/release/${release}.manifest.json`);
    if (manifest.sha256 !== payloadHash) {
      fail(`hash do manifesto (${String(manifest.sha256).slice(0, 16)}…) difere do payload real (${String(payloadHash).slice(0, 16)}…)`);
    }
    if (manifest.runId && manifest.runId !== run.runId) {
      fail(`manifesto pertence ao run ${manifest.runId} e não ao run corrente ${run.runId} (FOREIGN_RUN_ARTIFACT)`);
    }
    const candidateManifest = readJsonSafe(path.join(CANDIDATE_DIR, `${release}.candidate.manifest.json`));
    if (!candidateManifest) fail(`manifesto do candidato ausente: dist/candidate/${release}.candidate.manifest.json`);
    if (candidateManifest.candidateHash !== candidateHash) {
      fail(`candidateHash passado difere do candidato registrado (${String(candidateManifest.candidateHash).slice(0, 16)}…)`);
    }

    const identity = {
      artifactType: DELIVERED_ARTIFACT_TYPE,
      releasePhase: 'DELIVERED',
      release,
      sourceCommit: manifest.git_commit || null,
      sourceFingerprint: run.sourceFingerprint,
      candidateHash,
      parentCandidateHash: candidateHash,
      finalPayloadHash: payloadHash,
      governanceRunId: run.runId,
      createdAt,
      artifact: `${release}.payload.zip`,
      canonicalPath: `dist/release/${release}.payload.zip`,
      manifestPath: `dist/release/${release}.manifest.json`,
      lineage: {
        sourceCommit: manifest.git_commit || null,
        gitTree: manifest.git_tree || null,
        candidateManifestPath: `dist/candidate/${release}.candidate.manifest.json`,
        chain: [
          'SOURCE_FINGERPRINT',
          'CANDIDATE_HASH',
          'FINAL_PAYLOAD_HASH',
          'PACKAGE_MANIFEST',
          'SIGNATURE',
          'PUBLICATION',
        ],
      },
      hashDiscipline: 'finalPayloadHash cobre os BYTES do payload; vive FORA do payload (paradoxo do auto-hash evitado).',
      producedBy: 'scripts/two-pass-release.sh#pass4b',
    };
    const target = path.join(RELEASE_DIR, `${release}.delivered.identity.json`);
    writeJson(target, identity);
    console.log(`[release-identity] identidade do entregue: ${path.relative(ROOT, target)} payloadHash=${payloadHash.slice(0, 16)}…`);
    return;
  }

  fail(`--kind desconhecido: ${kind}`);
}

main();

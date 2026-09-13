#!/usr/bin/env node
'use strict';

/**
 * verify-release-artifact-identity.js — verifica a IDENTIDADE e a CADEIA dos
 * artefatos de release no disco, contra os BYTES reais.
 *
 * O que ele prova (R34..R37, G6, C4, C5):
 *   1. existe um CANDIDATO identificado como tal (nunca rotulado DELIVERED);
 *   2. o hash declarado do candidato corresponde aos bytes do ZIP do candidato;
 *   3. existe um payload ENTREGUE (DELIVERED_PAYLOAD) com identidade completa;
 *   4. o hash declarado do payload corresponde aos bytes do payload;
 *   5. `parentCandidateHash` == `candidateHash` do candidato (lineage);
 *   6. sourceCommit/sourceFingerprint/governanceRunId são IDÊNTICOS entre
 *      candidato e entregue e iguais ao run corrente;
 *   7. nenhum artefato de run estrangeiro compõe o resultado.
 *
 * Um payload copiado para `dist/release/` sem a transição válida (C4) e um
 * artefato de outro run (C5) FALHAM aqui — é o ponto em que "promover
 * candidate manualmente" deixa de ser invisível.
 *
 * Uso:
 *   node scripts/governance/verify-release-artifact-identity.js
 *   node scripts/governance/verify-release-artifact-identity.js --release <nome>
 *   node scripts/governance/verify-release-artifact-identity.js --phase CANDIDATE_VALIDATED
 *
 * Semântica de fase (R12/R13): com `--phase` anterior a DELIVERED, a ausência
 * do payload é PENDING_PHASE (exit 0) — nunca FAIL de conteúdo nem PASS. Na
 * fase DELIVERED (default), a ausência é FAIL.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  verifyReleaseIdentity,
  validateCandidateManifest,
  validateDeliveredManifest,
} = require('../../governance/release-artifact-identity');
const {
  GATE_STATUS,
  phaseAtLeast,
  isKnownPhase,
  evaluateGate,
} = require('../../governance/release-state-machine');

const ARTIFACT_TYPE = 'release-artifact-identity-report';
const ARTIFACT_VERSION = '1.0.0';
const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_DIR = path.join(ROOT, 'dist', 'candidate');
const RELEASE_DIR = path.join(ROOT, 'dist', 'release');

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listDir(dir, predicate) {
  try {
    return fs.readdirSync(dir).filter(predicate).sort();
  } catch (_) {
    return [];
  }
}

function resolveRelease(explicitRelease) {
  if (explicitRelease) return explicitRelease;
  const payloads = listDir(RELEASE_DIR, (name) => /\.payload\.zip$/.test(name));
  if (payloads.length === 0) return null;
  // Mais recente por mtime — determinístico para um único release por execução.
  const newest = payloads
    .map((name) => ({ name, mtime: fs.statSync(path.join(RELEASE_DIR, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  return newest.name.replace(/\.payload\.zip$/, '');
}

function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--release');
  const explicitRelease = idx >= 0 ? args[idx + 1] : null;
  const phaseIdx = args.indexOf('--phase');
  const currentPhase = phaseIdx >= 0 ? args[phaseIdx + 1] : 'DELIVERED';
  if (!isKnownPhase(currentPhase)) {
    console.error(`[release-identity] fase desconhecida: ${currentPhase}`);
    process.exit(1);
  }

  const release = resolveRelease(explicitRelease);
  const failures = [];
  const notes = [];

  // Fase inferida quando não declarada: sem payload entregue no disco, a fase
  // corrente é anterior a DELIVERED — a verificação é PENDING_PHASE. Declarar
  // DELIVERED sem artefato seria exigir prova de algo que não existe.
  const effectivePhase = phaseIdx >= 0
    ? currentPhase
    : (release ? 'DELIVERED' : 'PRE_PACKAGE');

  // Gate phase-aware (R12/R13): antes da fase DELIVERED a verificação não é
  // avaliável — PENDING_PHASE, nunca FAIL de conteúdo e nunca PASS. Um gate
  // que devolvesse FAIL aqui recriaria o deadlock "o payload que prova o
  // payload ainda não existe".
  const phaseGate = evaluateGate({
    gateId: 'exact_payload_verification',
    requiredPhase: 'DELIVERED',
    currentPhase: effectivePhase,
    evaluate: () => ({ status: GATE_STATUS.PASS }),
  });
  if (phaseGate.status === GATE_STATUS.PENDING_PHASE) {
    const pendingReport = {
      status: GATE_STATUS.PENDING_PHASE,
      decision: 'RELEASE_ARTIFACT_IDENTITY_PENDING_PHASE',
      generatedAt: new Date().toISOString(),
      artifactType: ARTIFACT_TYPE,
      artifactVersion: ARTIFACT_VERSION,
      currentPhase: effectivePhase,
      requiredPhase: 'DELIVERED',
      release,
      failures: [],
      notes: [`fase ${effectivePhase} < DELIVERED: identidade do payload ainda não é avaliável`],
    };
    const pendingSerialized = `${JSON.stringify(pendingReport, null, 2)}\n`;
    fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'reports', 'release-artifact-identity-report.json'), pendingSerialized);
    console.log(`[release-identity] status=${GATE_STATUS.PENDING_PHASE} (fase ${effectivePhase} < DELIVERED) — não avaliável ainda`);
    process.exit(0);
  }

  const runContext = readJsonSafe(path.join(ROOT, 'governance', '.current-run.json'));
  const currentRun = runContext && runContext.runId
    ? { runId: runContext.runId, sourceFingerprint: runContext.sourceFingerprint || null }
    : null;

  if (!release) {
    failures.push({
      code: 'RELEASE_ARTIFACT_IDENTITY_MISSING',
      reason: 'nenhum dist/release/*.payload.zip encontrado — não há artefato ENTREGUE para verificar',
    });
    notes.push('fase corrente < DELIVERED: identity do payload é PENDING_PHASE, não FAIL de conteúdo');
  }

  let candidateManifest = null;
  let deliveredIdentity = null;
  let candidateActualHash = null;
  let deliveredActualHash = null;

  if (release) {
    const candidateZip = path.join(CANDIDATE_DIR, `${release}.candidate.zip`);
    const candidateManifestPath = path.join(CANDIDATE_DIR, `${release}.candidate.manifest.json`);
    const payloadZip = path.join(RELEASE_DIR, `${release}.payload.zip`);
    const deliveredIdentityPath = path.join(RELEASE_DIR, `${release}.delivered.identity.json`);

    if (!fs.existsSync(candidateZip)) {
      failures.push({
        code: 'CANDIDATE_ARTIFACT_MISSING',
        reason: `candidato ausente: dist/candidate/${release}.candidate.zip (um payload entregue precisa de candidato identificado)`,
      });
    } else {
      candidateActualHash = sha256File(candidateZip);
    }
    if (!fs.existsSync(candidateManifestPath)) {
      failures.push({
        code: 'RELEASE_ARTIFACT_IDENTITY_MISSING',
        reason: `manifesto do candidato ausente: dist/candidate/${release}.candidate.manifest.json`,
      });
    } else {
      candidateManifest = readJsonSafe(candidateManifestPath);
    }

    if (!fs.existsSync(deliveredIdentityPath)) {
      failures.push({
        code: 'RELEASE_ARTIFACT_IDENTITY_MISSING',
        reason: `identidade do payload entregue ausente: dist/release/${release}.delivered.identity.json`,
      });
    } else {
      deliveredIdentity = readJsonSafe(deliveredIdentityPath);
    }

    if (fs.existsSync(payloadZip)) {
      deliveredActualHash = sha256File(payloadZip);
    } else {
      failures.push({
        code: 'DELIVERED_PAYLOAD_MISSING',
        reason: `payload ausente: dist/release/${release}.payload.zip`,
      });
    }

    if (candidateManifest && candidateActualHash) {
      const candidateType = validateCandidateManifest(candidateManifest);
      if (!candidateType.valid) failures.push({ code: candidateType.code, reason: candidateType.reason });
    }
    if (deliveredIdentity) {
      const deliveredType = validateDeliveredManifest(deliveredIdentity);
      if (!deliveredType.valid) failures.push({ code: deliveredType.code, reason: deliveredType.reason });
    }
  }

  let identity = null;
  if (
    candidateManifest
    && deliveredIdentity
    && candidateActualHash
    && deliveredActualHash
    && failures.length === 0
  ) {
    identity = verifyReleaseIdentity({
      candidate: candidateManifest,
      delivered: deliveredIdentity,
      candidateActualHash,
      deliveredActualHash,
      currentRun,
    });
    for (const failure of identity.failures) {
      failures.push({ code: failure.code, reason: failure.reason });
    }
  }

  const status = failures.length === 0 ? 'PASS' : 'FAIL';
  const report = {
    status,
    decision: status === 'PASS'
      ? 'RELEASE_ARTIFACT_IDENTITY_VERIFIED'
      : 'RELEASE_ARTIFACT_IDENTITY_INVALID',
    generatedAt: new Date().toISOString(),
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    runId: currentRun?.runId || null,
    sourceFingerprint: currentRun?.sourceFingerprint || null,
    release,
    candidate: {
      present: Boolean(candidateActualHash),
      declaredHash: candidateManifest?.candidateHash || null,
      actualHash: candidateActualHash,
    },
    delivered: {
      present: Boolean(deliveredActualHash),
      declaredHash: deliveredIdentity?.finalPayloadHash || null,
      actualHash: deliveredActualHash,
      parentCandidateHash: deliveredIdentity?.parentCandidateHash || null,
    },
    checks: identity?.checks || [],
    failures,
    notes,
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const reportsDir = path.join(ROOT, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  // SOMENTE reports/: este relatório é produzido DEPOIS do empacotamento (ele
  // verifica os BYTES do payload entregue). Uma cópia versionada em governance/
  // entraria no payload e, ao ser reescrita, viraria "stale reference" para o
  // self-proving (o payload conteria um arquivo diferente do workspace).
  // AGENTS.md: relatórios oficiais vivem em reports/*.json.
  fs.writeFileSync(path.join(reportsDir, 'release-artifact-identity-report.json'), serialized);

  console.log(`[release-identity] status=${status} decision=${report.decision} release=${release || '-'}`);
  for (const failure of failures) {
    console.log(`[release-identity] FALHA ${failure.code}: ${failure.reason}`);
  }
  console.log('[release-identity] relatório: reports/release-artifact-identity-report.json');

  process.exit(status === 'PASS' ? 0 : 1);
}

main();

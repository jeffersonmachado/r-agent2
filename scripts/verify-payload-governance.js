#!/usr/bin/env node
'use strict';

/**
 * Verify Payload Governance — verifier fail-closed da governança DO PAYLOAD.
 *
 * PRINCÍPIO: a verdade da certificação está vinculada à governança embutida no
 * payload (r-agent2/governance/), não aos arquivos soltos do envelope. O
 * envelope é camada de transporte/auditoria: suas decisões devem ser CÓPIAS
 * DERIVADAS da decisão canônica do payload, com binding de hash.
 *
 * Este script é autocontido (sem requires do projeto) para rodar offline a
 * partir de dist/verifier/ dentro do envelope entregue. NUNCA faz consulta
 * externa (rede/remote git): a proveniência remota é validada apenas como
 * evidência assinada/vinculada por hash dentro do payload (gate 18).
 *
 * Gates (qualquer FAIL → exit 1; 23 gates: 1–20 + 12b + 12c + 12d):
 *   1.  payload/manifest/envelope presentes
 *   2.  payload sha256 == manifest.sha256
 *   3.  governança canônica existe dentro do payload (MISSING_CANONICAL_GOVERNANCE)
 *   4.  decisão canônica do payload == GO (PAYLOAD_CANONICAL_NO_GO)
 *   5.  decisão do envelope == decisão canônica (GOVERNANCE_DECISION_MISMATCH)
 *   6.  runId: payload == manifest == envelope (CROSS_RUN_ARTIFACT)
 *   7.  sourceFingerprint: payload == manifest == envelope (SOURCE_FINGERPRINT_MISMATCH)
 *   8.  payload readiness == AUTONOMOUS_READY_GO
 *   9.  payload package-validation ok + lineage (runId, sourceFingerprint)
 *   10. payload package-integrity == PACKAGE_INTEGRITY_GO
 *   11. payload self-proving == PASS
 *   12. payload master scorecard 78/78, 0 blockers, 0 gaps
 *   13. envelope final-governance.canonicalSha256 == sha256(canônico do payload)
 *   14. envelope package-validation FINAL ok + sha256(payload) bindado
 *   15. envelope package-integrity pass
 *   16. envelope self-proving pass
 *   17. attestation Ed25519 válida + campos == manifest/payload/decisão
 *   18. manifest cleanWorktree=true + gitCommit/gitTree 40-char + evidência de
 *       proveniência REMOTA packageRequired (source-remote-provenance-report:
 *       status PASS, commit/tree == manifest, commitExists/treeMatches=true,
 *       hash binding no evidence-manifest — REMOTE_PROVENANCE_EVIDENCE_MISSING /
 *       REMOTE_PROVENANCE_MISMATCH / REMOTE_PROVENANCE_NOT_IN_MANIFEST /
 *       REMOTE_PROVENANCE_EVIDENCE_HASH_MISMATCH)
 *   19. consistência: decisão DEFERRED exige phase=PRE_PACKAGE/transitional
 *       (SEMANTIC_PHASE_MISMATCH — relatório "final" nunca carrega DEFERRED)
 *   20. release_hygiene: envelope sem verify-result stale (STALE_VERIFIER_RESULT),
 *       sem artefatos de outro release (FOREIGN_RELEASE_ARTIFACT), sem paths
 *       temporários/runtime (TEMP_PATH_ARTIFACT/RUNTIME_ARTIFACT)
 *   12b. payload_experience_segregation: evidência packageRequired dentro do
 *       payload (EXPERIENCE_SEGREGATION_EVIDENCE_MISSING / NO_GO /
 *       EVIDENCE_HASH_MISMATCH), runId/fingerprint == manifest
 *   12d. payload_experience_api_segregation: prova SERVER-SIDE packageRequired
 *       dentro do payload (EXPERIENCE_API_SEGREGATION_EVIDENCE_MISSING /
 *       NO_GO / LEAKS / NOT_IN_MANIFEST / NOT_PACKAGE_REQUIRED /
 *       EVIDENCE_HASH_MISMATCH), runId/fingerprint == manifest e contadores
 *       productionTechnicalLeaks/supportEngineeringLeaks/directUrlBypasses = 0
 *   12c. final_status_projection_consistency: projeções derivadas DENTRO do
 *       payload (docs/architecture/RAP_MASTER_SCORECARD.md, docs/governance/
 *       PLATFORM_STATUS.md, ENTERPRISE_READINESS.md, _platform-status-source.json,
 *       dev/platform-readiness/latest.json) devem refletir exatamente a canônica
 *       embutida — decisão, score N/total, runId, sourceFingerprint
 *       (FINAL_STATUS_PROJECTION_STALE / MISSING_PROJECTION)
 *
 * Uso:
 *   node verify-payload-governance.js --root <dir-com-dist-ou-envelope-extraído>
 *   node verify-payload-governance.js --candidate --root <dir>   (fase DELIVERED: exige DEFERRED verbatim)
 *   node verify-payload-governance.js --payload <zip> --manifest <json> --envelope-governance <dir> --signatures <dir>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const GO_DECISIONS = new Set(['GO', 'AUTONOMOUS_READY_GO', 'AUTONOMOUS_READY', 'PASS', 'DELIVERED_RELEASE_VERIFIED']);
const CANONICAL_REL = 'r-agent2/governance/final-governance-report.json';
const PAYLOAD_GOV_REL = 'r-agent2/governance';
// Fase DELIVERED: candidato selado com decisão DEFERRED verdadeira (RAP-055/056
// só são evidenciáveis pós-selo, contra o artefato entregue). Nunca vira GO.
const DEFERRED_DECISION = 'PASS_WITH_DEFERRED_PACKAGE_GATE';
const DEFERRED_ALLOWED_BELOW10 = new Set(['RAP-055', 'RAP-056']);

function normalizeDecision(decision) {
  return (typeof decision === 'string' && GO_DECISIONS.has(decision)) ? 'GO' : 'NO_GO';
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function makeGate(id, mandatory = true) {
  return { id, status: 'PASS', mandatory, reason: null };
}
function pass(gate, extra = {}) { return Object.assign(gate, extra); }
function fail(gate, reason, extra = {}) {
  return Object.assign(gate, { status: 'FAIL', reason }, extra);
}

// ─── Resolução de artefatos ───────────────────────────────────────────────────
function resolveInputs(args) {
  const inputs = {};
  if (args.root) {
    const root = path.resolve(args.root);
    // Aceita: raiz do projeto (dist/release), raiz de dist, ou envelope extraído (r-agent2/dist).
    const candidates = [
      path.join(root, 'dist', 'release'),
      path.join(root, 'dist'),
      path.join(root, 'r-agent2', 'dist', 'release'),
      root,
    ];
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      const payload = fs.readdirSync(dir).find((f) => f.endsWith('.payload.zip'));
      if (payload) {
        inputs.payloadPath = path.join(dir, payload);
        const manifestName = `${payload.replace(/\.payload\.zip$/, '')}.manifest.json`;
        const manifestCandidate = path.join(dir, manifestName);
        if (fs.existsSync(manifestCandidate)) inputs.manifestPath = manifestCandidate;
        break;
      }
    }
    const govCandidates = [
      path.join(root, 'dist', 'governance'),
      path.join(root, 'r-agent2', 'dist', 'governance'),
      path.join(root, 'governance'),
    ];
    inputs.envelopeGovDir = govCandidates.find((d) => fs.existsSync(path.join(d, 'final-governance-report.json'))) || null;
    const sigCandidates = [
      path.join(root, 'dist', 'signatures'),
      path.join(root, 'r-agent2', 'dist', 'signatures'),
    ];
    inputs.signaturesDir = sigCandidates.find((d) => fs.existsSync(d)) || null;
    const verCandidates = [
      path.join(root, 'dist', 'verifier'),
      path.join(root, 'r-agent2', 'dist', 'verifier'),
    ];
    inputs.verifierDir = verCandidates.find((d) => fs.existsSync(d)) || null;
  }
  if (args.payload) inputs.payloadPath = path.resolve(args.payload);
  if (args.manifest) inputs.manifestPath = path.resolve(args.manifest);
  if (args.envelopeGovernance) inputs.envelopeGovDir = path.resolve(args.envelopeGovernance);
  if (args.signatures) inputs.signaturesDir = path.resolve(args.signatures);
  if (args.verifier) inputs.verifierDir = path.resolve(args.verifier);
  if (args.envelope) inputs.envelopePath = path.resolve(args.envelope);
  // Envelope zip: irmão do payload no mesmo diretório (r-agent2-*.zip não-payload).
  if (!inputs.envelopePath && inputs.payloadPath) {
    const dir = path.dirname(inputs.payloadPath);
    try {
      const envelope = fs.readdirSync(dir).find((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f));
      if (envelope) inputs.envelopePath = path.join(dir, envelope);
    } catch (_) { /* best effort */ }
  }
  return inputs;
}

function extractPayload(payloadPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-payload-verify-'));
  execFileSync('unzip', ['-qq', payloadPath, '-d', tmpDir], { stdio: 'pipe' });
  return tmpDir;
}

// ─── Verificação principal ────────────────────────────────────────────────────
function verifyPayloadGovernance(args) {
  return runVerification(args, { candidateMode: false });
}

/**
 * Verificação de CANDIDATO da fase DELIVERED: a governança canônica do payload
 * deve carregar exatamente PASS_WITH_DEFERRED_PACKAGE_GATE (decisão DEFERRED
 * verdadeira, nunca promovida a GO) e o envelope deve copiá-la verbatim.
 * Um candidato NÃO é release: o modo estrito acima continua exigindo GO.
 */
function verifyDeferredCandidate(args) {
  return runVerification(args, { candidateMode: true });
}

function runVerification(args, options) {
  const candidateMode = options.candidateMode === true;
  const gates = [];
  const inputs = resolveInputs(args);
  let tmpDir = null;

  const cleanup = () => {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    }
  };

  try {
    // ── Gate 1: artefatos presentes ─────────────────────────────────────────
    const presence = makeGate('artifact_presence');
    if (!inputs.payloadPath || !fs.existsSync(inputs.payloadPath)) {
      gates.push(fail(presence, 'MISSING_PAYLOAD — payload.zip não encontrado'));
      return finish(gates, cleanup, candidateMode);
    }
    if (!inputs.manifestPath || !fs.existsSync(inputs.manifestPath)) {
      gates.push(fail(presence, 'MISSING_MANIFEST — manifest não encontrado'));
      return finish(gates, cleanup, candidateMode);
    }
    if (!inputs.envelopeGovDir) {
      gates.push(fail(presence, 'MISSING_ENVELOPE_GOVERNANCE — dist/governance não encontrado'));
      return finish(gates, cleanup, candidateMode);
    }
    gates.push(pass(presence));

    const manifest = readJson(inputs.manifestPath);
    if (!manifest) {
      gates.push(fail(makeGate('manifest_parse'), 'INVALID_ARTIFACT — manifest ilegível'));
      return finish(gates, cleanup, candidateMode);
    }

    // ── Gate 2: payload hash binding ────────────────────────────────────────
    const payloadSha = sha256File(inputs.payloadPath);
    const hashGate = makeGate('payload_hash_binding');
    if (manifest.sha256 !== payloadSha && manifest.packageFingerprint !== payloadSha) {
      gates.push(fail(hashGate, `PACKAGE_HASH_MISMATCH — manifest.sha256=${manifest.sha256} != sha256(payload)=${payloadSha}`));
    } else {
      gates.push(pass(hashGate, { payloadSha256: payloadSha }));
    }

    // ── Gate 3-4: governança canônica dentro do payload ─────────────────────
    tmpDir = extractPayload(inputs.payloadPath);
    const payloadGovDir = path.join(tmpDir, PAYLOAD_GOV_REL);
    const canonicalPath = path.join(tmpDir, CANONICAL_REL);
    const canonical = readJson(canonicalPath);

    const canonPresence = makeGate('canonical_governance_presence');
    if (!canonical) {
      gates.push(fail(canonPresence, `MISSING_CANONICAL_GOVERNANCE — ${CANONICAL_REL} ausente no payload`));
      return finish(gates, cleanup, candidateMode);
    }
    gates.push(pass(canonPresence));

    const canonicalDecision = normalizeDecision(canonical.finalDecision || canonical.decision);
    const canonDecision = makeGate('canonical_decision');
    if (candidateMode) {
      if (canonical.finalDecision !== DEFERRED_DECISION) {
        gates.push(fail(canonDecision,
          `CANDIDATE_DECISION_INVALID — candidato DELIVERED exige finalDecision=${DEFERRED_DECISION}, encontrado=${canonical.finalDecision || 'null'}`));
      } else {
        gates.push(pass(canonDecision, { finalDecision: canonical.finalDecision }));
      }
    } else if (canonicalDecision !== 'GO') {
      gates.push(fail(canonDecision,
        `PAYLOAD_CANONICAL_NO_GO — finalDecision=${canonical.finalDecision || canonical.decision || 'null'}`));
    } else {
      gates.push(pass(canonDecision, { finalDecision: canonical.finalDecision }));
    }

    // ── Gate 5: decisão do envelope == decisão canônica ─────────────────────
    const envGov = readJson(path.join(inputs.envelopeGovDir, 'final-governance-report.json'));
    const decisionGate = makeGate('governance_decision_match');
    if (!envGov) {
      gates.push(fail(decisionGate, 'MISSING_ENVELOPE_GOVERNANCE — final-governance-report.json ausente no envelope'));
    } else if (candidateMode) {
      // Candidato: cópia verbatim — envelope GO + payload DEFERRED é mismatch.
      if (envGov.finalDecision !== canonical.finalDecision) {
        gates.push(fail(decisionGate,
          `GOVERNANCE_DECISION_MISMATCH — envelope=${envGov.finalDecision} diverge da canônica do payload=${canonical.finalDecision}`));
      } else {
        gates.push(pass(decisionGate));
      }
    } else {
      const envelopeDecision = normalizeDecision(envGov.finalDecision || envGov.decision);
      if (envelopeDecision !== canonicalDecision) {
        gates.push(fail(decisionGate,
          `GOVERNANCE_DECISION_MISMATCH — envelope=${envelopeDecision} (${envGov.finalDecision}) diverge da canônica do payload=${canonicalDecision} (${canonical.finalDecision})`));
      } else {
        gates.push(pass(decisionGate));
      }
    }

    // ── Gate 6-7: runId + sourceFingerprint consistency ─────────────────────
    const runGate = makeGate('run_id_consistency');
    const manifestRunId = manifest.runId || null;
    const payloadRunId = canonical.runId || null;
    const envelopeRunId = envGov?.runId || null;
    if (!manifestRunId || !payloadRunId) {
      gates.push(fail(runGate, `ARTIFACT_RUN_ID_MISSING — manifest.runId=${manifestRunId} payload.runId=${payloadRunId}`));
    } else if (manifestRunId !== payloadRunId || (envelopeRunId && envelopeRunId !== manifestRunId)) {
      gates.push(fail(runGate,
        `CROSS_RUN_ARTIFACT — manifest=${manifestRunId} payload=${payloadRunId} envelope=${envelopeRunId}`));
    } else {
      gates.push(pass(runGate, { runId: manifestRunId }));
    }

    const fpGate = makeGate('source_fingerprint_consistency');
    const manifestFp = manifest.sourceFingerprint || null;
    const payloadFp = canonical.sourceFingerprint || null;
    const envelopeFp = envGov?.sourceFingerprint || null;
    if (!manifestFp || !payloadFp) {
      gates.push(fail(fpGate, `SOURCE_FINGERPRINT_MISSING — manifest=${!!manifestFp} payload=${!!payloadFp}`));
    } else if (manifestFp !== payloadFp || (envelopeFp && envelopeFp !== manifestFp)) {
      gates.push(fail(fpGate,
        `SOURCE_FINGERPRINT_MISMATCH — manifest=${manifestFp.slice(0, 12)} payload=${(payloadFp || '').slice(0, 12)} envelope=${(envelopeFp || '').slice(0, 12)}`));
    } else {
      gates.push(pass(fpGate));
    }

    // ── Gate 8: readiness do payload ────────────────────────────────────────
    const readiness = readJson(path.join(payloadGovDir, 'final-readiness-report.json'));
    const readinessGate = makeGate('payload_readiness');
    const readinessDecision = readiness?.finalDecision || readiness?.status;
    if (candidateMode) {
      if (readinessDecision !== DEFERRED_DECISION && readinessDecision !== 'AUTONOMOUS_READY_GO') {
        gates.push(fail(readinessGate, `PAYLOAD_READINESS_NOT_GO — finalDecision=${readinessDecision || 'null'}`));
      } else {
        gates.push(pass(readinessGate, { finalDecision: readinessDecision }));
      }
    } else if (readinessDecision !== 'AUTONOMOUS_READY_GO') {
      gates.push(fail(readinessGate, `PAYLOAD_READINESS_NOT_GO — finalDecision=${readinessDecision || 'null'}`));
    } else {
      gates.push(pass(readinessGate));
    }

    // ── Gate 9: package-validation do payload (com lineage) ─────────────────
    const pkgVal = readJson(path.join(payloadGovDir, 'package-validation-report.json'));
    const pkgValGate = makeGate('payload_package_validation');
    if (!pkgVal) {
      gates.push(fail(pkgValGate, 'MISSING_ARTIFACT — package-validation-report.json ausente no payload'));
    } else if (!pkgVal.runId || !pkgVal.sourceFingerprint) {
      gates.push(fail(pkgValGate, 'ARTIFACT_RUN_ID_MISSING — package-validation do payload sem lineage (runId/sourceFingerprint)'));
    } else if (pkgVal.ok !== true) {
      gates.push(fail(pkgValGate, `PAYLOAD_PACKAGE_VALIDATION_FAIL — ok=${pkgVal.ok} status=${pkgVal.status || 'n/a'} error=${pkgVal.error || 'n/a'}`));
    } else if (manifestRunId && pkgVal.runId !== manifestRunId) {
      gates.push(fail(pkgValGate, `CROSS_RUN_ARTIFACT — package-validation.runId=${pkgVal.runId} != ${manifestRunId}`));
    } else {
      gates.push(pass(pkgValGate));
    }

    // ── Gate 10: package-integrity do payload ───────────────────────────────
    const pkgInt = readJson(path.join(payloadGovDir, 'package-integrity-report.json'));
    const pkgIntGate = makeGate('payload_package_integrity');
    if (!pkgInt) {
      gates.push(fail(pkgIntGate, 'MISSING_ARTIFACT — package-integrity-report.json ausente no payload'));
    } else if (pkgInt.decision !== 'PACKAGE_INTEGRITY_GO' && pkgInt.pass !== true) {
      gates.push(fail(pkgIntGate, `PAYLOAD_PACKAGE_INTEGRITY_NO_GO — decision=${pkgInt.decision || 'null'}`));
    } else {
      gates.push(pass(pkgIntGate));
    }

    // ── Gate 11: self-proving do payload ────────────────────────────────────
    const selfProof = readJson(path.join(payloadGovDir, 'self-proving-report.json'));
    const selfProofGate = makeGate('payload_self_proving');
    if (!selfProof) {
      gates.push(fail(selfProofGate, 'MISSING_ARTIFACT — self-proving-report.json ausente no payload'));
    } else if (selfProof.pass !== true && selfProof.selfProofStatus !== 'PASS') {
      gates.push(fail(selfProofGate, `PAYLOAD_SELF_PROVING_FAIL — status=${selfProof.selfProofStatus || 'null'} score=${selfProof.overallSelfProofScore ?? 'n/a'}`));
    } else {
      gates.push(pass(selfProofGate));
    }

    // ── Gate 12: master scorecard do payload 78/78 ──────────────────────────
    const scorecard = readJson(path.join(payloadGovDir, 'rap-master-scorecard.json'));
    const scorecardGate = makeGate('payload_master_scorecard');
    if (!scorecard || !Array.isArray(scorecard.dimensions)) {
      gates.push(fail(scorecardGate, 'MISSING_ARTIFACT — rap-master-scorecard.json ausente/inválido no payload'));
    } else {
      const below10 = scorecard.dimensions.filter((d) => Number(d.score) < 10);
      const blockers = Array.isArray(scorecard.blockers) ? scorecard.blockers.length : 0;
      const allGaps = Array.isArray(scorecard.gaps) ? scorecard.gaps : [];
      // Gaps com status DEFERRED pertencem às dimensões adiadas (RAP-055/056) —
      // são a definição da fase DELIVERED, não violações. Apenas gaps abertos
      // (não DEFERRED) invalidam — no candidato e no release final.
      const gaps = allGaps.filter((g) => g && g.status !== 'DEFERRED').length;
      if (candidateMode) {
        const unexpected = below10.filter((d) => !DEFERRED_ALLOWED_BELOW10.has(d.id));
        if (unexpected.length > 0 || blockers > 0 || gaps > 0) {
          gates.push(fail(scorecardGate,
            `CANDIDATE_SCORECARD_INVALID — candidato admite below10 ⊆ {RAP-055,RAP-056}; unexpected=[${unexpected.map((d) => d.id).join(',')}] blockers=${blockers} openGaps=${gaps}`));
        } else {
          gates.push(pass(scorecardGate, { deferredDimensions: below10.map((d) => d.id) }));
        }
      } else if (below10.length > 0 || blockers > 0 || gaps > 0) {
        gates.push(fail(scorecardGate,
          `MASTER_SCORECARD_NOT_10_OF_10 — ${scorecard.dimensions.length - below10.length}/${scorecard.dimensions.length} below10=[${below10.map((d) => d.id).join(',')}] blockers=${blockers} gaps=${gaps}`));
      } else {
        gates.push(pass(scorecardGate, { dimensions: scorecard.dimensions.length }));
      }
    }

    // ── Gate 12b: evidência de experience-segregation DENTRO do payload ──────
    // A prova de segregação PRODUCTION/SUPPORT/DEVELOPMENT é packageRequired:
    // vive em governance/experience-segregation-report.json dentro do payload
    // (vinculada ao release via payloadSha256, coberto pela attestation Ed25519)
    // e deve ter hash registrado no evidence-manifest embutido.
    const expSeg = readJson(path.join(payloadGovDir, 'experience-segregation-report.json'));
    const expSegGate = makeGate('payload_experience_segregation');
    if (!expSeg) {
      gates.push(fail(expSegGate, 'EXPERIENCE_SEGREGATION_EVIDENCE_MISSING — governance/experience-segregation-report.json ausente no payload'));
    } else if (expSeg.status !== 'PASS') {
      gates.push(fail(expSegGate, `EXPERIENCE_SEGREGATION_NO_GO — status=${expSeg.status || 'null'}`));
    } else if (Number(expSeg.violationCount || 0) > 0) {
      gates.push(fail(expSegGate, `EXPERIENCE_SEGREGATION_NO_GO — violationCount=${expSeg.violationCount}`));
    } else if (!expSeg.runId || !expSeg.sourceFingerprint) {
      gates.push(fail(expSegGate, 'ARTIFACT_RUN_ID_MISSING — experience-segregation do payload sem lineage (runId/sourceFingerprint)'));
    } else if (manifestRunId && expSeg.runId !== manifestRunId) {
      gates.push(fail(expSegGate, `CROSS_RUN_ARTIFACT — experience-segregation.runId=${expSeg.runId} != ${manifestRunId}`));
    } else if (manifestFp && expSeg.sourceFingerprint !== manifestFp) {
      gates.push(fail(expSegGate, 'SOURCE_FINGERPRINT_MISMATCH — experience-segregation.sourceFingerprint diverge do manifest'));
    } else {
      // Binding de hash: o evidence-manifest do payload registra o sha256 da
      // prova; deve conferir com o arquivo físico embutido.
      const evidenceManifest = readJson(path.join(payloadGovDir, 'evidence-manifest.json'));
      const expEntry = Array.isArray(evidenceManifest?.artifacts)
        ? evidenceManifest.artifacts.find((a) => a && a.id === 'experience_segregation')
        : null;
      const recordedHash = expEntry ? (expEntry.hash || expEntry.sha256 || expEntry.checksum || null) : null;
      const physicalHash = sha256File(path.join(payloadGovDir, 'experience-segregation-report.json'));
      if (!expEntry) {
        gates.push(fail(expSegGate, 'EXPERIENCE_SEGREGATION_NOT_IN_MANIFEST — evidence-manifest do payload sem entrada experience_segregation (binding de hash obrigatório)'));
      } else if (expEntry.packageRequired !== true) {
        gates.push(fail(expSegGate, 'EXPERIENCE_SEGREGATION_NOT_PACKAGE_REQUIRED — evidence-manifest não marca a prova como packageRequired'));
      } else if (!recordedHash) {
        gates.push(fail(expSegGate, 'EXPERIENCE_SEGREGATION_EVIDENCE_HASH_MISSING — entrada experience_segregation sem hash registrado'));
      } else if (recordedHash !== physicalHash) {
        gates.push(fail(expSegGate,
          `EXPERIENCE_SEGREGATION_EVIDENCE_HASH_MISMATCH — manifest=${recordedHash.slice(0, 12)} != físico=${physicalHash.slice(0, 12)}`));
      } else {
        gates.push(pass(expSegGate, { violationCount: 0, hashBound: true }));
      }
    }

    // ── Gate 12d: evidência de experience-API-segregation DENTRO do payload ──
    // Prova SERVER-SIDE (complemento do gate 12b, que cobre o frontend):
    // validate-experience-api-segregation emite o relatório com lineage e a
    // cópia canônica em governance/experience-api-segregation-report.json,
    // packageRequired=true no evidence-manifest embutido. PASS exige os três
    // contadores de vazamento zerados.
    const expApiSeg = readJson(path.join(payloadGovDir, 'experience-api-segregation-report.json'));
    const expApiSegGate = makeGate('payload_experience_api_segregation');
    if (!expApiSeg) {
      gates.push(fail(expApiSegGate, 'EXPERIENCE_API_SEGREGATION_EVIDENCE_MISSING — governance/experience-api-segregation-report.json ausente no payload'));
    } else if (expApiSeg.status !== 'PASS') {
      gates.push(fail(expApiSegGate, `EXPERIENCE_API_SEGREGATION_NO_GO — status=${expApiSeg.status || 'null'}`));
    } else if (Number(expApiSeg.counts?.productionTechnicalLeaks || 0) > 0
      || Number(expApiSeg.counts?.supportEngineeringLeaks || 0) > 0
      || Number(expApiSeg.counts?.directUrlBypasses || 0) > 0) {
      gates.push(fail(expApiSegGate, `EXPERIENCE_API_SEGREGATION_LEAKS — counts=${JSON.stringify(expApiSeg.counts || {})}`));
    } else if (!expApiSeg.runId || !expApiSeg.sourceFingerprint) {
      gates.push(fail(expApiSegGate, 'ARTIFACT_RUN_ID_MISSING — experience-api-segregation do payload sem lineage (runId/sourceFingerprint)'));
    } else if (manifestRunId && expApiSeg.runId !== manifestRunId) {
      gates.push(fail(expApiSegGate, `CROSS_RUN_ARTIFACT — experience-api-segregation.runId=${expApiSeg.runId} != ${manifestRunId}`));
    } else if (manifestFp && expApiSeg.sourceFingerprint !== manifestFp) {
      gates.push(fail(expApiSegGate, 'SOURCE_FINGERPRINT_MISMATCH — experience-api-segregation.sourceFingerprint diverge do manifest'));
    } else {
      const apiEvidenceManifest = readJson(path.join(payloadGovDir, 'evidence-manifest.json'));
      const apiEntry = Array.isArray(apiEvidenceManifest?.artifacts)
        ? apiEvidenceManifest.artifacts.find((a) => a && a.id === 'experience_api_segregation')
        : null;
      const apiRecordedHash = apiEntry ? (apiEntry.hash || apiEntry.sha256 || apiEntry.checksum || null) : null;
      const apiPhysicalHash = sha256File(path.join(payloadGovDir, 'experience-api-segregation-report.json'));
      if (!apiEntry) {
        gates.push(fail(expApiSegGate, 'EXPERIENCE_API_SEGREGATION_NOT_IN_MANIFEST — evidence-manifest do payload sem entrada experience_api_segregation (binding de hash obrigatório)'));
      } else if (apiEntry.packageRequired !== true) {
        gates.push(fail(expApiSegGate, 'EXPERIENCE_API_SEGREGATION_NOT_PACKAGE_REQUIRED — evidence-manifest não marca a prova como packageRequired'));
      } else if (!apiRecordedHash) {
        gates.push(fail(expApiSegGate, 'EXPERIENCE_API_SEGREGATION_EVIDENCE_HASH_MISSING — entrada experience_api_segregation sem hash registrado'));
      } else if (apiRecordedHash !== apiPhysicalHash) {
        gates.push(fail(expApiSegGate,
          `EXPERIENCE_API_SEGREGATION_EVIDENCE_HASH_MISMATCH — manifest=${apiRecordedHash.slice(0, 12)} != físico=${apiPhysicalHash.slice(0, 12)}`));
      } else {
        gates.push(pass(expApiSegGate, { leaks: 0, hashBound: true }));
      }
    }

    // ── Gate 12c: projeções de status final do payload vs canônica embutida ──
    // BLOCKER 2 (r-agent2-20260905-163709): a canônica do payload estava 78/78
    // AUTONOMOUS_READY_GO mas os docs empacotados diziam 76/78, IN_PROGRESS e
    // NO_GO. As projeções derivadas DENTRO do payload devem refletir exatamente
    // a canônica embutida (decisão, score, runId, sourceFingerprint). Lógica
    // espelhada de scripts/governance/validate-final-status-projection.js —
    // duplicada aqui de propósito: este verifier é autocontido (sem requires
    // do projeto) para rodar offline a partir de dist/verifier/.
    const projGate = makeGate('final_status_projection_consistency');
    {
      const projIssues = [];
      const payloadRoot = path.join(tmpDir, 'r-agent2');
      const projDecision = canonical.finalDecision || canonical.decision;
      const scDims = Array.isArray(scorecard?.dimensions) ? scorecard.dimensions : [];
      const scSummary = scorecard?.summary || {};
      const projTotal = scSummary.totalDimensions ?? (scDims.length || null);
      const projAt10 = scSummary.dimensionsAt10 ?? (scDims.length ? scDims.filter((d) => Number(d.score) >= 10).length : null);
      const projBelow10 = scSummary.dimensionsBelow10 ?? (scDims.length ? scDims.filter((d) => Number(d.score) < 10).length : null);
      const projStatus = scorecard?.overallStatus || null;
      const projRunId = canonical.runId || readiness?.runId || scorecard?.runId || null;
      const projFp = canonical.sourceFingerprint || readiness?.sourceFingerprint || scorecard?.sourceFingerprint || null;

      const scanScoreTokens = (content, rel) => {
        if (projTotal == null || projAt10 == null) return;
        const re = /(\d+)\s*\/\s*(\d+)/g;
        let m;
        while ((m = re.exec(content))) {
          if (Number(m[2]) === projTotal && Number(m[1]) !== projAt10) {
            projIssues.push(`STALE_SCORE — token=${m[0]} esperado=${projAt10}/${projTotal} em ${rel}`);
          }
        }
      };
      const scanJsonStrings = (value, rel) => {
        if (typeof value === 'string') {
          // Evidência embutida (base64/data URI) não é conteúdo decisório.
          if (value.length <= 200) scanScoreTokens(value, rel);
          return;
        }
        if (Array.isArray(value)) { value.forEach((item) => scanJsonStrings(item, rel)); return; }
        if (value && typeof value === 'object') {
          for (const item of Object.values(value)) scanJsonStrings(item, rel);
        }
      };

      const mdSpecs = [
        { rel: 'docs/governance/ENTERPRISE_READINESS.md', pattern: /Decision:\s*([^\s]+)/, expected: projDecision, label: 'Decision' },
        { rel: 'docs/governance/PLATFORM_STATUS.md', pattern: /Readiness decision:\s*([^\s]+)/, expected: projDecision, label: 'Readiness decision' },
        { rel: 'docs/architecture/RAP_MASTER_SCORECARD.md', pattern: /Overall status:\s*\*\*([A-Z_]+)\*\*/, expected: projStatus, label: 'Overall status' },
      ];
      for (const spec of mdSpecs) {
        const full = path.join(payloadRoot, spec.rel);
        if (!fs.existsSync(full)) {
          projIssues.push(`MISSING_PROJECTION — ${spec.rel} ausente no payload`);
          continue;
        }
        const content = fs.readFileSync(full, 'utf8');
        if (spec.expected) {
          const match = content.match(spec.pattern);
          if (!match) {
            projIssues.push(`PROJECTION_TOKEN_NOT_FOUND — ${spec.label} em ${spec.rel}`);
          } else if (match[1].trim() !== spec.expected) {
            projIssues.push(`STALE_DECISION — ${spec.rel}: ${spec.label}=${match[1].trim()} esperado=${spec.expected}`);
          }
        }
        scanScoreTokens(content, spec.rel);
      }

      // Scorecard MD: linhas de sumário + lineage contra o scorecard embutido.
      const scMdPath = path.join(payloadRoot, 'docs/architecture/RAP_MASTER_SCORECARD.md');
      if (fs.existsSync(scMdPath)) {
        const scMd = fs.readFileSync(scMdPath, 'utf8');
        const summaryLines = [
          { label: 'Dimensions', pattern: /^- Dimensions:\s*(\d+)/m, expectedValue: projTotal },
          { label: '10/10', pattern: /^- 10\/10:\s*(\d+)/m, expectedValue: projAt10 },
          { label: 'Below 10', pattern: /^- Below 10:\s*(\d+)/m, expectedValue: projBelow10 },
        ];
        for (const { label, pattern, expectedValue } of summaryLines) {
          if (expectedValue == null) continue;
          const match = scMd.match(pattern);
          if (!match) projIssues.push(`MISSING_PROJECTION_LINE — "- ${label}:" em RAP_MASTER_SCORECARD.md`);
          else if (Number(match[1]) !== expectedValue) projIssues.push(`STALE_SCORE — ${label}=${match[1]} esperado=${expectedValue} em RAP_MASTER_SCORECARD.md`);
        }
        if (projRunId) {
          const match = scMd.match(/^- Run ID:\s*(\S+)/m);
          if (!match) projIssues.push('MISSING_PROJECTION_LINE — "- Run ID:" em RAP_MASTER_SCORECARD.md');
          else if (match[1] !== projRunId) projIssues.push(`STALE_RUN_ID — RAP_MASTER_SCORECARD.md Run ID=${match[1]} esperado=${projRunId}`);
        }
        if (projFp) {
          const match = scMd.match(/^- Source fingerprint:\s*(\S+)/m);
          if (!match) projIssues.push('MISSING_PROJECTION_LINE — "- Source fingerprint:" em RAP_MASTER_SCORECARD.md');
          else if (match[1] !== projFp) projIssues.push('STALE_SOURCE_FINGERPRINT — RAP_MASTER_SCORECARD.md diverge da canônica');
        }
      }

      for (const rel of ['docs/governance/_platform-status-source.json', 'dev/platform-readiness/latest.json']) {
        const proj = readJson(path.join(payloadRoot, rel));
        if (!proj) {
          projIssues.push(`MISSING_PROJECTION — ${rel} ausente/ilegível no payload`);
          continue;
        }
        if (projDecision && proj.finalDecision !== projDecision) {
          projIssues.push(`STALE_DECISION — ${rel}: finalDecision=${proj.finalDecision || 'null'} esperado=${projDecision}`);
        }
        if (projRunId && proj.runId !== projRunId) {
          projIssues.push(`STALE_RUN_ID — ${rel}: runId=${proj.runId || 'null'} esperado=${projRunId}`);
        }
        if (projFp && proj.sourceFingerprint !== projFp) {
          projIssues.push(`STALE_SOURCE_FINGERPRINT — ${rel} diverge da canônica`);
        }
        scanJsonStrings(proj, rel);
      }

      if (projIssues.length > 0) {
        gates.push(fail(projGate, `FINAL_STATUS_PROJECTION_STALE — ${projIssues.join(' | ')}`));
      } else {
        gates.push(pass(projGate, { projectionsChecked: 5 }));
      }
    }

    // ── Gates exclusivos do candidato: proof + tamper do payload ────────────
    if (candidateMode) {
      const proof = readJson(path.join(payloadGovDir, 'final-proof-report.json'));
      const proofGate = makeGate('payload_proof');
      const proofDecision = proof?.finalDecision || proof?.decision;
      const proofOk = proofDecision === 'AUTONOMOUS_READY_GO' || proofDecision === DEFERRED_DECISION;
      if (!proof) {
        gates.push(fail(proofGate, 'MISSING_ARTIFACT — final-proof-report.json ausente no payload'));
      } else if (!proofOk) {
        gates.push(fail(proofGate, `PAYLOAD_PROOF_NO_GO — finalDecision=${proofDecision || 'null'}`));
      } else if (Array.isArray(proof.blockers) && proof.blockers.length > 0) {
        gates.push(fail(proofGate, `PAYLOAD_PROOF_BLOCKERS — blockers=${proof.blockers.length}`));
      } else {
        gates.push(pass(proofGate));
      }

      const tamper = readJson(path.join(payloadGovDir, 'tamper-detection-report.json'));
      const tamperGate = makeGate('payload_tamper');
      const tamperDecision = tamper?.decision || tamper?.status;
      if (!tamper) {
        gates.push(fail(tamperGate, 'MISSING_ARTIFACT — tamper-detection-report.json ausente no payload'));
      } else if (tamperDecision !== 'TAMPER_GO' && tamperDecision !== 'GO' && tamper.pass !== true) {
        gates.push(fail(tamperGate, `PAYLOAD_TAMPER_NO_GO — decision=${tamperDecision || 'null'}`));
      } else {
        gates.push(pass(tamperGate));
      }
    }

    // ── Gate 13: binding de hash do canônico no envelope ────────────────────
    const bindingGate = makeGate('canonical_hash_binding');
    const canonicalSha = sha256File(canonicalPath);
    if (!envGov) {
      gates.push(fail(bindingGate, 'MISSING_ENVELOPE_GOVERNANCE'));
    } else if (!envGov.canonicalSha256) {
      gates.push(fail(bindingGate, 'CANONICAL_HASH_MISSING — envelope final-governance sem canonicalSha256 (cópia não vinculada)'));
    } else if (envGov.canonicalSha256 !== canonicalSha) {
      gates.push(fail(bindingGate,
        `CANONICAL_HASH_MISMATCH — envelope.canonicalSha256=${envGov.canonicalSha256.slice(0, 12)} != sha256(payload canonical)=${canonicalSha.slice(0, 12)}`));
    } else {
      gates.push(pass(bindingGate));
    }

    // ── Gate 14-16: relatórios FINAL do envelope ────────────────────────────
    const envPkgVal = readJson(path.join(inputs.envelopeGovDir, 'package-validation-report.json'));
    const envPkgValGate = makeGate('envelope_package_validation_final');
    if (!envPkgVal) {
      gates.push(fail(envPkgValGate, 'MISSING_ARTIFACT — package-validation-report.json ausente no envelope'));
    } else if (envPkgVal.ok !== true) {
      gates.push(fail(envPkgValGate, `PACKAGE_VALIDATION_FAIL — envelope ok=${envPkgVal.ok}`));
    } else if ((envPkgVal.payloadSha256 || envPkgVal.zipSha256) && (envPkgVal.payloadSha256 || envPkgVal.zipSha256) !== payloadSha) {
      gates.push(fail(envPkgValGate, 'PACKAGE_HASH_MISMATCH — package-validation do envelope não está bindado ao payload entregue'));
    } else {
      gates.push(pass(envPkgValGate));
    }

    const envPkgInt = readJson(path.join(inputs.envelopeGovDir, 'package-integrity-report.json'));
    const envPkgIntGate = makeGate('envelope_package_integrity');
    if (!envPkgInt || (envPkgInt.pass !== true && envPkgInt.decision !== 'PACKAGE_INTEGRITY_GO')) {
      gates.push(fail(envPkgIntGate, `PACKAGE_INTEGRITY_NO_GO — envelope decision=${envPkgInt?.decision || 'null'}`));
    } else {
      gates.push(pass(envPkgIntGate));
    }

    const envSelfProof = readJson(path.join(inputs.envelopeGovDir, 'self-proving-report.json'));
    const envSpGate = makeGate('envelope_self_proving');
    if (!envSelfProof || (envSelfProof.pass !== true && envSelfProof.selfProofStatus !== 'PASS')) {
      gates.push(fail(envSpGate, `SELF_PROVING_FAIL — envelope status=${envSelfProof?.selfProofStatus || 'null'}`));
    } else {
      gates.push(pass(envSpGate));
    }

    // ── Gate 17: attestation Ed25519 ────────────────────────────────────────
    const attGate = makeGate('release_attestation_signature');
    const sigPath = inputs.signaturesDir ? path.join(inputs.signaturesDir, 'release-attestation.sig') : null;
    const sig = sigPath && fs.existsSync(sigPath) ? readJson(sigPath) : null;
    if (!sig) {
      gates.push(fail(attGate, 'SIGNATURE_MISSING — release-attestation.sig ausente no envelope'));
    } else {
      const pubKeyCandidates = [
        inputs.verifierDir && path.join(inputs.verifierDir, 'release-attestation-public-key.json'),
        path.join(__dirname, '..', 'governance', 'release-attestation-public-key.json'),
      ].filter(Boolean);
      let pubPem = null;
      for (const candidate of pubKeyCandidates) {
        const data = fs.existsSync(candidate) ? readJson(candidate) : null;
        if (data?.publicKey) { pubPem = data.publicKey; break; }
      }
      if (!pubPem) {
        gates.push(fail(attGate, 'SIGNATURE_KEY_MISSING — chave pública de verificação não encontrada'));
      } else {
        const att = sig.attestation || {};
        const canonicalPayload = canonicalJson(att);
        let signatureValid = false;
        try {
          signatureValid = sig.algorithm === 'ed25519'
            && canonicalPayload === sig.canonicalPayload
            && crypto.verify(null, Buffer.from(canonicalPayload, 'utf8'), pubPem, Buffer.from(sig.signature || '', 'hex'));
        } catch (_) {
          signatureValid = false;
        }
        if (!signatureValid) {
          gates.push(fail(attGate, 'SIGNATURE_INVALID — verificação Ed25519 falhou'));
        } else {
          const fieldMismatches = [];
          const expect = {
            runId: manifestRunId,
            sourceFingerprint: manifestFp,
            gitCommit: manifest.git_commit || manifest.gitCommit,
            gitTree: manifest.git_tree || manifest.gitTree,
            payloadSha256: payloadSha,
            finalDecision: canonical.finalDecision,
          };
          for (const [key, value] of Object.entries(expect)) {
            if (value && att[key] !== value) fieldMismatches.push(`${key}: attestation=${String(att[key]).slice(0, 12)} esperado=${String(value).slice(0, 12)}`);
          }
          const manifestSha = sha256File(inputs.manifestPath);
          if (att.manifestSha256 && att.manifestSha256 !== manifestSha) {
            fieldMismatches.push('manifestSha256 diverge do manifest entregue');
          }
          if (fieldMismatches.length > 0) {
            gates.push(fail(attGate, `SIGNATURE_FIELD_MISMATCH — ${fieldMismatches.join(' | ')}`));
          } else {
            gates.push(pass(attGate, { algorithm: 'ed25519' }));
          }
        }
      }
    }

    // ── Gate 18: proveniência do manifest ───────────────────────────────────
    const provGate = makeGate('manifest_provenance');
    const commit = manifest.git_commit || manifest.gitCommit || '';
    const tree = manifest.git_tree || manifest.gitTree || '';
    if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(tree)) {
      gates.push(fail(provGate, 'SOURCE_COMMIT_MISMATCH — gitCommit/gitTree ausentes ou malformados no manifest'));
    } else if (manifest.cleanWorktree !== true) {
      gates.push(fail(provGate, 'DIRTY_WORKTREE — manifest não declara cleanWorktree=true'));
    } else {
      // Extensão: proveniência REMOTA do source. O verifier é OFFLINE — não
      // consulta o remote; valida a evidência produzida por
      // verify-remote-provenance antes do SEAL_GO, vinculada ao pacote pelo
      // payloadSha256 (coberto pela attestation Ed25519) e com hash registrado
      // no evidence-manifest embutido (entrada source_remote_provenance).
      const remoteProv = readJson(path.join(payloadGovDir, 'source-remote-provenance-report.json'));
      if (!remoteProv) {
        gates.push(fail(provGate, 'REMOTE_PROVENANCE_EVIDENCE_MISSING — governance/source-remote-provenance-report.json ausente no payload'));
      } else if (remoteProv.status !== 'PASS') {
        gates.push(fail(provGate, `REMOTE_PROVENANCE_MISMATCH — status=${remoteProv.status || 'null'} failureCode=${remoteProv.failureCode || 'null'}`));
      } else if (remoteProv.commit !== commit || remoteProv.tree !== tree) {
        gates.push(fail(provGate, 'REMOTE_PROVENANCE_MISMATCH — commit/tree da evidência divergem do manifest'));
      } else if (remoteProv.commitExists !== true || remoteProv.treeMatches !== true) {
        gates.push(fail(provGate, `REMOTE_PROVENANCE_MISMATCH — commitExists=${remoteProv.commitExists} treeMatches=${remoteProv.treeMatches}`));
      } else {
        const rpEvidenceManifest = readJson(path.join(payloadGovDir, 'evidence-manifest.json'));
        const rpEntry = Array.isArray(rpEvidenceManifest?.artifacts)
          ? rpEvidenceManifest.artifacts.find((a) => a && a.id === 'source_remote_provenance')
          : null;
        const rpRecordedHash = rpEntry ? (rpEntry.hash || rpEntry.sha256 || rpEntry.checksum || null) : null;
        const rpPhysicalHash = sha256File(path.join(payloadGovDir, 'source-remote-provenance-report.json'));
        if (!rpEntry) {
          gates.push(fail(provGate, 'REMOTE_PROVENANCE_NOT_IN_MANIFEST — evidence-manifest do payload sem entrada source_remote_provenance (binding de hash obrigatório)'));
        } else if (rpEntry.packageRequired !== true) {
          gates.push(fail(provGate, 'REMOTE_PROVENANCE_NOT_PACKAGE_REQUIRED — evidence-manifest não marca a prova como packageRequired'));
        } else if (!rpRecordedHash) {
          gates.push(fail(provGate, 'REMOTE_PROVENANCE_EVIDENCE_HASH_MISSING — entrada source_remote_provenance sem hash registrado'));
        } else if (rpRecordedHash !== rpPhysicalHash) {
          gates.push(fail(provGate,
            `REMOTE_PROVENANCE_EVIDENCE_HASH_MISMATCH — manifest=${rpRecordedHash.slice(0, 12)} != físico=${rpPhysicalHash.slice(0, 12)}`));
        } else {
          gates.push(pass(provGate, { remoteProvenance: true, hashBound: true }));
        }
      }
    }

    // ── Gate 19: fase semântica da consistência ─────────────────────────────
    // O payload carrega o snapshot PRÉ-package do final-consistency-report
    // (estrutural: o pacote não pode conter a prova de si mesmo). Um relatório
    // com decisão DEFERRED DEVE se declarar phase=PRE_PACKAGE/transitional —
    // nunca FINAL. Um relatório "FINAL" com decisão DEFERRED é incoerência
    // semântica (PASS_WITH_DEFERRED_PACKAGE_GATE apresentado como final).
    const phaseGate = makeGate('consistency_phase_semantics');
    const payloadConsistency = readJson(path.join(payloadGovDir, 'final-consistency-report.json'));
    if (!payloadConsistency) {
      gates.push(fail(phaseGate, 'MISSING_ARTIFACT — final-consistency-report.json ausente no payload'));
    } else {
      const consDecision = payloadConsistency.finalDecision || payloadConsistency.decision || null;
      const consPhase = payloadConsistency.phase || null;
      const consTransitional = payloadConsistency.transitional === true;
      if (consDecision === DEFERRED_DECISION && (consPhase !== 'PRE_PACKAGE' || !consTransitional)) {
        gates.push(fail(phaseGate,
          `SEMANTIC_PHASE_MISMATCH — decisão ${DEFERRED_DECISION} exige phase=PRE_PACKAGE transitional=true; encontrado phase=${consPhase || 'null'} transitional=${payloadConsistency.transitional}`));
      } else if (consPhase === 'FINAL' && consDecision === DEFERRED_DECISION) {
        gates.push(fail(phaseGate,
          'SEMANTIC_PHASE_MISMATCH — relatório FINAL não pode carregar decisão DEFERRED'));
      } else {
        gates.push(pass(phaseGate, { phase: consPhase, finalDecision: consDecision }));
      }
    }

    // ── Gate 20: higiene do envelope/release ────────────────────────────────
    // O envelope é camada de transporte limpa: NUNCA contém recibo de verifier
    // pré-gerado (STALE_VERIFIER_RESULT), artefatos de outro release, paths
    // temporários ou saída de runtime. verify-result.json só é produzido
    // QUANDO o verifier roda contra o pacote entregue — fora do envelope.
    const hygieneGate = makeGate('release_hygiene');
    const hygieneIssues = [];
    let envelopeEntries = null;
    if (inputs.envelopePath && fs.existsSync(inputs.envelopePath)) {
      try {
        const listing = execFileSync('unzip', ['-Z1', inputs.envelopePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        envelopeEntries = listing.split(/\r?\n/g).map((e) => e.trim()).filter(Boolean);
      } catch (error) {
        hygieneIssues.push(`ENVELOPE_UNREADABLE — ${error.message}`);
      }
    }
    if (envelopeEntries) {
      const payloadName = path.basename(inputs.payloadPath);
      const currentReleaseId = payloadName.replace(/\.payload\.zip$/, '');
      for (const entry of envelopeEntries) {
        if (/(^|\/)verify-result\.json$/.test(entry)) {
          hygieneIssues.push(`STALE_VERIFIER_RESULT — ${entry} é recibo de execução do verifier e não pode ser empacotado`);
        }
        if (/(^|\/)tmp\//.test(entry) || /\/tmp\//.test(entry)) {
          hygieneIssues.push(`TEMP_PATH_ARTIFACT — ${entry}`);
        }
        if (/\.(log|wal|shm|tmp)$/.test(entry)) {
          hygieneIssues.push(`RUNTIME_ARTIFACT — ${entry}`);
        }
        if (!candidateMode && /CANDIDATE-DEFERRED\.json$/.test(entry)) {
          hygieneIssues.push(`STALE_CANDIDATE_MARKER — ${entry} em release GO final`);
        }
        const m = entry.match(/r-agent2-(\d{8}-\d{6})/);
        if (m && `r-agent2-${m[1]}` !== currentReleaseId) {
          hygieneIssues.push(`FOREIGN_RELEASE_ARTIFACT — ${entry} pertence a r-agent2-${m[1]}, release atual é ${currentReleaseId}`);
        }
      }
    }
    if (hygieneIssues.length > 0) {
      gates.push(fail(hygieneGate, hygieneIssues.join(' | ')));
    } else {
      gates.push(pass(hygieneGate, { envelopeScanned: envelopeEntries ? envelopeEntries.length : 0 }));
    }

    return finish(gates, cleanup, candidateMode);
  } catch (error) {
    gates.push(fail(makeGate('verifier_error'), `VERIFIER_ERROR — ${error.message}`));
    return finish(gates, cleanup, candidateMode);
  }
}

function finish(gates, cleanup, candidateMode = false) {
  cleanup();
  const failed = gates.filter((g) => g.status === 'FAIL' && g.mandatory);
  const ok = failed.length === 0;
  const decision = ok
    ? (candidateMode ? 'DELIVERED_PHASE_CANDIDATE_VERIFIED' : 'PAYLOAD_GOVERNANCE_VERIFIED')
    : (candidateMode ? 'DELIVERED_PHASE_CANDIDATE_NO_GO' : 'PAYLOAD_GOVERNANCE_NO_GO');
  return {
    decision,
    pass: ok,
    failedGates: failed.map((g) => ({ id: g.id, reason: g.reason })),
    gates: gates.map((g) => ({ id: g.id, status: g.status, reason: g.reason || null })),
  };
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) { args[key] = argv[i + 1]; i += 1; }
      else args[key] = true;
    }
  }
  return args;
}

if (require.main === module) {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const result = cliArgs.candidate === true
    ? verifyDeferredCandidate(cliArgs)
    : verifyPayloadGovernance(cliArgs);
  console.log('─'.repeat(60));
  console.log('PAYLOAD GOVERNANCE GATES');
  console.log('─'.repeat(60));
  for (const gate of result.gates) {
    const icon = gate.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${gate.id.padEnd(36)} ${gate.status}${gate.reason ? ` — ${gate.reason}` : ''}`);
  }
  console.log('─'.repeat(60));
  console.log(`DECISION: ${result.decision}`);
  process.exit(result.pass ? 0 : 1);
}

module.exports = { verifyPayloadGovernance, verifyDeferredCandidate, normalizeDecision, DEFERRED_DECISION };

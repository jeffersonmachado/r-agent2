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
 * partir de dist/verifier/ dentro do envelope entregue.
 *
 * Gates (qualquer FAIL → exit 1):
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
 *   18. manifest cleanWorktree=true + gitCommit/gitTree 40-char
 *
 * Uso:
 *   node verify-payload-governance.js --root <dir-com-dist-ou-envelope-extraído>
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
  return inputs;
}

function extractPayload(payloadPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-payload-verify-'));
  execFileSync('unzip', ['-qq', payloadPath, '-d', tmpDir], { stdio: 'pipe' });
  return tmpDir;
}

// ─── Verificação principal ────────────────────────────────────────────────────
function verifyPayloadGovernance(args) {
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
      return finish(gates, cleanup);
    }
    if (!inputs.manifestPath || !fs.existsSync(inputs.manifestPath)) {
      gates.push(fail(presence, 'MISSING_MANIFEST — manifest não encontrado'));
      return finish(gates, cleanup);
    }
    if (!inputs.envelopeGovDir) {
      gates.push(fail(presence, 'MISSING_ENVELOPE_GOVERNANCE — dist/governance não encontrado'));
      return finish(gates, cleanup);
    }
    gates.push(pass(presence));

    const manifest = readJson(inputs.manifestPath);
    if (!manifest) {
      gates.push(fail(makeGate('manifest_parse'), 'INVALID_ARTIFACT — manifest ilegível'));
      return finish(gates, cleanup);
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
      return finish(gates, cleanup);
    }
    gates.push(pass(canonPresence));

    const canonicalDecision = normalizeDecision(canonical.finalDecision || canonical.decision);
    const canonDecision = makeGate('canonical_decision');
    if (canonicalDecision !== 'GO') {
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
    if (readinessDecision !== 'AUTONOMOUS_READY_GO') {
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
      const gaps = Array.isArray(scorecard.gaps) ? scorecard.gaps.length : 0;
      if (below10.length > 0 || blockers > 0 || gaps > 0) {
        gates.push(fail(scorecardGate,
          `MASTER_SCORECARD_NOT_10_OF_10 — ${scorecard.dimensions.length - below10.length}/${scorecard.dimensions.length} below10=[${below10.map((d) => d.id).join(',')}] blockers=${blockers} gaps=${gaps}`));
      } else {
        gates.push(pass(scorecardGate, { dimensions: scorecard.dimensions.length }));
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
      gates.push(pass(provGate));
    }

    return finish(gates, cleanup);
  } catch (error) {
    gates.push(fail(makeGate('verifier_error'), `VERIFIER_ERROR — ${error.message}`));
    return finish(gates, cleanup);
  }
}

function finish(gates, cleanup) {
  cleanup();
  const failed = gates.filter((g) => g.status === 'FAIL' && g.mandatory);
  const decision = failed.length === 0 ? 'PAYLOAD_GOVERNANCE_VERIFIED' : 'PAYLOAD_GOVERNANCE_NO_GO';
  return {
    decision,
    pass: failed.length === 0,
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
  const result = verifyPayloadGovernance(parseCliArgs(process.argv.slice(2)));
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

module.exports = { verifyPayloadGovernance, normalizeDecision };

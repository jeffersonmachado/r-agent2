'use strict';

/**
 * Fixture de release completo (payload + manifest + envelope + attestation)
 * para testes dos verifiers fail-closed.
 *
 * Constrói em um diretório temporário uma estrutura dist/ idêntica à produzida
 * pelo two-pass-release pós-hardening:
 *
 *   dist/release/<id>.payload.zip   (com r-agent2/governance/* embutido)
 *   dist/release/<id>.manifest.json
 *   dist/governance/*.json          (envelope derivado da canônica do payload)
 *   dist/signatures/release-attestation.sig  (Ed25519, keypair de teste)
 *   dist/verifier/release-attestation-public-key.json
 *
 * Opções de adulteração permitem produzir fixtures NO_GO para testes negativos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ATTESTATION = require('../../governance/release-attestation');

const RELEASE_ID = '20260101-000000';
const RUN_ID = 'rap-governed-20260101000000000-fixture01';
const SOURCE_FP = 'a'.repeat(64);
const GIT_COMMIT = 'b'.repeat(40);
const GIT_TREE = 'c'.repeat(40);

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function writeJson(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(data, null, 2)}\n`);
}

function lineage(artifactType) {
  return {
    artifactType,
    artifactVersion: '1.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    runId: RUN_ID,
    sourceFingerprint: SOURCE_FP,
    gitCommit: GIT_COMMIT,
    gitTree: GIT_TREE,
  };
}

function buildScorecard(below10Ids = [], lin = lineage) {
  const dimensions = [];
  for (let i = 1; i <= 78; i += 1) {
    const id = `RAP-${String(i).padStart(3, '0')}`;
    dimensions.push({ id, name: id, score: below10Ids.includes(id) ? 6 : 10, target: 10 });
  }
  const at10 = 78 - below10Ids.length;
  return {
    ...lin('rap-master-scorecard'),
    schema: 'rap-master-scorecard/v2',
    overallStatus: below10Ids.length > 0 ? 'IN_PROGRESS' : 'VERIFIED',
    summary: { totalDimensions: 78, dimensionsAt10: at10, dimensionsBelow10: below10Ids.length },
    dimensions,
    blockers: [],
    gaps: [],
  };
}

/**
 * @param {string} baseDir  diretório raiz da fixture (será criado)
 * @param {object} [tamper] opções de adulteração:
 *   payloadDecision      finalDecision canônica embutida (default AUTONOMOUS_READY_GO)
 *   envelopeDecision     finalDecision do envelope (default = payloadDecision)
 *   skipCanonicalHashBinding  não grava canonicalSha256 no envelope
 *   wrongCanonicalHash   grava canonicalSha256 incorreto
 *   payloadRunId / manifestRunId / envelopeRunId
 *   payloadSourceFingerprint / manifestSourceFingerprint
 *   payloadPkgValOk      ok do package-validation embutido (default true)
 *   payloadPkgValLineage incluir lineage no pkg-val embutido (default true)
 *   payloadIntegrityDecision  (default PACKAGE_INTEGRITY_GO)
 *   payloadSelfProofPass (default true)
 *   payloadProofDecision finalDecision do final-proof embutido (default = payloadDecision)
 *   payloadTamperDecision  decision do tamper-detection embutido (default TAMPER_GO)
 *   scorecardBelow10     ids com score 6 no scorecard embutido (default [])
 *   envelopePkgValOk     (default true)
 *   envelopeIntegrityPass (default true)
 *   envelopeSelfProofPass (default true)
 *   skipAttestation      não grava release-attestation.sig
 *   invalidAttestation   grava assinatura de outra chave
 *   attestationFieldOverrides  sobrescreve campos do atestado (re-assinado corretamente)
 *   manifestOverrides    campos extras/alterados no manifest (pós-assinatura se afetar hash)
 *   cleanWorktree        default true
 *   omitPayloadGovernance  payload sem r-agent2/governance
 *   consistencyDecision  finalDecision do final-consistency-report embutido
 *                        (default PASS_WITH_DEFERRED_PACKAGE_GATE — snapshot PRE_PACKAGE)
 *   consistencyPhase     phase do consistency report (default PRE_PACKAGE;
 *                        'FINAL' + decisão DEFERRED → SEMANTIC_PHASE_MISMATCH)
 *   consistencyTransitional  default true
 *   omitExperienceSegregation  payload sem experience-segregation-report (Caso C)
 *   expSegStatus         default 'PASS' ('FAIL' → Caso G)
 *   expSegViolationCount default 0 (>0 → Caso F)
 *   expSegRunId / expSegSourceFingerprint  lineage divergente (Casos D/E)
 *   expSegNoLineage      remove runId/sourceFingerprint (ARTIFACT_RUN_ID_MISSING)
 *   expSegHashMismatch   evidence-manifest registra hash errado (Caso H)
 *   expSegNotPackageRequired  evidence-manifest sem packageRequired=true
 *   buildEnvelope        constrói o envelope zip físico (release_hygiene)
 *   envelopeExtraFiles   { path: content } extras dentro do envelope zip
 *                        (ex.: 'r-agent2/dist/verifier/verify-result.json' → Caso A/B)
 *   omitPayloadProjections  payload sem as projeções derivadas (docs + latest.json)
 *   projectionDecision   finalDecision das projeções embutidas (default = payloadDecision)
 *   projectionStatusDecision  "Readiness decision" do PLATFORM_STATUS.md embutido
 *   projectionScorecardMdAt10  valor da linha "10/10:" do scorecard MD embutido
 *   projectionScorecardMdStatus  "Overall status" do scorecard MD embutido
 *   projectionRunId / projectionSourceFingerprint  lineage das projeções embutidas
 */
function buildReleaseFixture(baseDir, tamper = {}, identity = {}) {
  const RELEASE = identity.releaseId || RELEASE_ID;
  const RUN = identity.runId || RUN_ID;
  const FP = identity.sourceFingerprint || SOURCE_FP;
  const COMMIT = identity.gitCommit || GIT_COMMIT;
  const TREE = identity.gitTree || GIT_TREE;
  const lin = (artifactType) => ({
    ...lineage(artifactType),
    runId: RUN,
    sourceFingerprint: FP,
    gitCommit: COMMIT,
    gitTree: TREE,
  });

  const keyDir = path.join(baseDir, 'keys');
  process.env.RAP_RELEASE_KEY_DIR = keyDir;
  ATTESTATION.generateKeyPair({ force: true });

  const payloadDecision = tamper.payloadDecision || 'AUTONOMOUS_READY_GO';
  const envelopeDecision = tamper.envelopeDecision || payloadDecision;
  const payloadRunId = tamper.payloadRunId || RUN;
  const manifestRunId = tamper.manifestRunId || RUN;
  const envelopeRunId = tamper.envelopeRunId || manifestRunId;
  const payloadFp = tamper.payloadSourceFingerprint || FP;
  const manifestFp = tamper.manifestSourceFingerprint || FP;

  // ── 1. Governança embutida no payload ──────────────────────────────────────
  const payloadTree = path.join(baseDir, 'payload-tree');
  const govDir = path.join(payloadTree, 'r-agent2', 'governance');
  fs.mkdirSync(govDir, { recursive: true });

  if (!tamper.omitPayloadGovernance) {
    writeJson(path.join(govDir, 'final-governance-report.json'), {
      ...lin('final-governance-report'),
      runId: payloadRunId,
      sourceFingerprint: payloadFp,
      finalDecision: payloadDecision,
    });
    writeJson(path.join(govDir, 'final-readiness-report.json'), {
      ...lin('final-readiness-report'),
      finalDecision: tamper.payloadReadinessDecision || 'AUTONOMOUS_READY_GO',
      status: tamper.payloadReadinessDecision || 'AUTONOMOUS_READY_GO', blockingGaps: [],
    });
    const pkgVal = {
      ...lin('package-validation-report'),
      ok: tamper.payloadPkgValOk !== undefined ? tamper.payloadPkgValOk : true,
      status: 'PASS', zipName: `r-agent2-${RELEASE}.payload.zip`,
    };
    if (tamper.payloadPkgValLineage === false) {
      delete pkgVal.runId;
      delete pkgVal.sourceFingerprint;
    }
    writeJson(path.join(govDir, 'package-validation-report.json'), pkgVal);
    writeJson(path.join(govDir, 'package-integrity-report.json'), {
      ...lin('package-integrity-report'),
      pass: (tamper.payloadIntegrityDecision || 'PACKAGE_INTEGRITY_GO') === 'PACKAGE_INTEGRITY_GO',
      decision: tamper.payloadIntegrityDecision || 'PACKAGE_INTEGRITY_GO',
    });
    writeJson(path.join(govDir, 'self-proving-report.json'), {
      ...lin('self-proving-report'),
      pass: tamper.payloadSelfProofPass !== undefined ? tamper.payloadSelfProofPass : true,
      selfProofStatus: (tamper.payloadSelfProofPass === false) ? 'FAIL' : 'PASS',
      overallSelfProofScore: 100,
    });
    const payloadScorecard = buildScorecard(tamper.scorecardBelow10 || [], lin);
    writeJson(path.join(govDir, 'rap-master-scorecard.json'), payloadScorecard);
    writeJson(path.join(govDir, 'final-proof-report.json'), {
      ...lin('final-proof-report'),
      finalDecision: tamper.payloadProofDecision || payloadDecision,
      blockers: [],
    });
    writeJson(path.join(govDir, 'tamper-detection-report.json'), {
      ...lin('tamper-detection-report'),
      decision: tamper.payloadTamperDecision || 'TAMPER_GO',
      pass: (tamper.payloadTamperDecision || 'TAMPER_GO') === 'TAMPER_GO',
    });

    // Consistência PRE_PACKAGE (snapshot estrutural do payload): decisão
    // DEFERRED exige phase=PRE_PACKAGE/transitional — o gate
    // consistency_phase_semantics reprova DEFERRED apresentado como FINAL.
    writeJson(path.join(govDir, 'final-consistency-report.json'), {
      ...lin('final-consistency-report'),
      finalDecision: tamper.consistencyDecision || 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      phase: tamper.consistencyPhase !== undefined ? tamper.consistencyPhase : 'PRE_PACKAGE',
      transitional: tamper.consistencyTransitional !== undefined ? tamper.consistencyTransitional : true,
      pass: true,
    });

    // Evidência de experience-segregation (packageRequired=true): prova de
    // segregação PRODUCTION/SUPPORT/DEVELOPMENT embutida no payload, com hash
    // registrado no evidence-manifest embutido.
    if (!tamper.omitExperienceSegregation) {
      const expSeg = {
        ...lin('experience-segregation-report'),
        status: tamper.expSegStatus || 'PASS',
        violationCount: tamper.expSegViolationCount || 0,
        violations: [],
      };
      if (tamper.expSegRunId) expSeg.runId = tamper.expSegRunId;
      if (tamper.expSegSourceFingerprint) expSeg.sourceFingerprint = tamper.expSegSourceFingerprint;
      if (tamper.expSegNoLineage) { delete expSeg.runId; delete expSeg.sourceFingerprint; }
      const expSegPath = path.join(govDir, 'experience-segregation-report.json');
      writeJson(expSegPath, expSeg);
      const expSegHash = tamper.expSegHashMismatch ? '0'.repeat(64) : sha256File(expSegPath);
      writeJson(path.join(govDir, 'evidence-manifest.json'), {
        ...lin('evidence-manifest'),
        status: 'PASS',
        artifacts: tamper.expSegManifestEntryMissing ? [] : [
          {
            id: 'experience_segregation',
            path: 'governance/experience-segregation-report.json',
            packageRequired: tamper.expSegNotPackageRequired === true ? false : true,
            exists: true,
            hash: expSegHash,
            proofStatus: 'valid',
          },
        ],
      });
    }

    // Projeções derivadas da canônica embutida (gate final_status_projection_consistency):
    // docs + latest.json devem refletir decisão/score/runId/fingerprint da
    // governança canônica do payload. Tamper options adulteram UM aspecto.
    if (!tamper.omitPayloadProjections) {
      const projDecision = tamper.projectionDecision || payloadDecision;
      const projRunId = tamper.projectionRunId || payloadRunId;
      const projFp = tamper.projectionSourceFingerprint || payloadFp;
      const scAt10 = tamper.projectionScorecardMdAt10 ?? payloadScorecard.summary.dimensionsAt10;
      const scStatusMd = tamper.projectionScorecardMdStatus || payloadScorecard.overallStatus;
      const statusDecision = tamper.projectionStatusDecision || projDecision;
      const docsDir = path.join(payloadTree, 'r-agent2', 'docs');
      const scorecardMd = [
        '# RAP Master Scorecard',
        '',
        `- Generated at: ${payloadScorecard.generatedAt}`,
        `- Run ID: ${projRunId}`,
        `- Source fingerprint: ${projFp}`,
        `- Overall status: **${scStatusMd}**`,
        `- Dimensions: ${payloadScorecard.summary.totalDimensions}`,
        `- 10/10: ${scAt10}`,
        `- Below 10: ${payloadScorecard.summary.dimensionsBelow10}`,
        '',
      ].join('\n');
      fs.mkdirSync(path.join(docsDir, 'architecture'), { recursive: true });
      fs.mkdirSync(path.join(docsDir, 'governance'), { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'architecture', 'RAP_MASTER_SCORECARD.md'), scorecardMd);
      fs.writeFileSync(path.join(docsDir, 'governance', 'PLATFORM_STATUS.md'), [
        '# Platform Status',
        '',
        `- Generated at: ${payloadScorecard.generatedAt}`,
        `- Readiness decision: ${statusDecision}`,
        '- Readiness score: 100',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(docsDir, 'governance', 'ENTERPRISE_READINESS.md'), [
        '# Enterprise Readiness',
        '',
        `- Decision: ${projDecision}`,
        '',
      ].join('\n'));
      const statusSource = {
        generatedAt: payloadScorecard.generatedAt,
        runId: projRunId,
        sourceFingerprint: projFp,
        finalDecision: projDecision,
        productionReadiness: { status: projDecision },
      };
      writeJson(path.join(docsDir, 'governance', '_platform-status-source.json'), statusSource);
      writeJson(path.join(payloadTree, 'r-agent2', 'dev', 'platform-readiness', 'latest.json'), statusSource);
    }
  }

  // ── 2. Payload zip ─────────────────────────────────────────────────────────
  const releaseDir = path.join(baseDir, 'dist', 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const payloadName = `r-agent2-${RELEASE}.payload.zip`;
  const payloadPath = path.join(releaseDir, payloadName);
  execFileSync('zip', ['-qr', payloadPath, 'r-agent2/'], { cwd: payloadTree });
  const payloadSha = sha256File(payloadPath);

  // ── 3. Manifest ────────────────────────────────────────────────────────────
  const manifestPath = path.join(releaseDir, `r-agent2-${RELEASE}.manifest.json`);
  const manifest = {
    artifact: payloadName,
    sha256: payloadSha,
    packageFingerprint: payloadSha,
    runId: manifestRunId,
    sourceFingerprint: manifestFp,
    git_commit: COMMIT,
    git_tree: TREE,
    git_branch: 'main',
    git_ref: 'refs/heads/main',
    cleanWorktree: tamper.cleanWorktree !== undefined ? tamper.cleanWorktree : true,
    createdAt: '2026-01-01T00:01:00.000Z',
    audit: 'passed',
    ...(tamper.manifestOverrides || {}),
  };
  writeJson(manifestPath, manifest);
  const manifestSha = sha256File(manifestPath);

  // ── 4. Envelope derivado ───────────────────────────────────────────────────
  const envGovDir = path.join(baseDir, 'dist', 'governance');
  const canonicalPath = path.join(govDir, 'final-governance-report.json');
  const canonicalSha = tamper.wrongCanonicalHash
    ? '0'.repeat(64)
    : (fs.existsSync(canonicalPath) ? sha256File(canonicalPath) : null);

  const envelopeFinalGov = {
    ...lin('final-governance-report'),
    runId: envelopeRunId,
    finalDecision: envelopeDecision,
    decision: envelopeDecision,
    pass: envelopeDecision === 'AUTONOMOUS_READY_GO' || envelopeDecision === 'GO',
    canonicalSource: 'payload:r-agent2/governance/final-governance-report.json',
    derivedFromCanonical: true,
    payload: payloadName,
    payloadSha256: payloadSha,
    status: 'final',
  };
  if (!tamper.skipCanonicalHashBinding && canonicalSha) envelopeFinalGov.canonicalSha256 = canonicalSha;
  writeJson(path.join(envGovDir, 'final-governance-report.json'), envelopeFinalGov);

  writeJson(path.join(envGovDir, 'package-validation-report.json'), {
    ...lin('package-validation-report'),
    ok: tamper.envelopePkgValOk !== undefined ? tamper.envelopePkgValOk : true,
    pass: true,
    payload: payloadName,
    payloadSha256: tamper.envelopePkgValShaWrong ? '1'.repeat(64) : payloadSha,
    finalDecision: envelopeDecision,
    status: 'final',
  });
  writeJson(path.join(envGovDir, 'package-integrity-report.json'), {
    ...lin('package-integrity-report'),
    pass: tamper.envelopeIntegrityPass !== undefined ? tamper.envelopeIntegrityPass : true,
    decision: (tamper.envelopeIntegrityPass === false) ? 'PACKAGE_INTEGRITY_NO_GO' : 'PACKAGE_INTEGRITY_GO',
    payloadSha256: payloadSha,
    finalDecision: envelopeDecision,
    status: 'final',
  });
  writeJson(path.join(envGovDir, 'self-proving-report.json'), {
    ...lin('self-proving-report'),
    pass: tamper.envelopeSelfProofPass !== undefined ? tamper.envelopeSelfProofPass : true,
    selfProofStatus: (tamper.envelopeSelfProofPass === false) ? 'FAIL' : 'PASS',
    verifierPassed: true,
    packageValidationOk: true,
    packageIntegrityPass: true,
    staleReferencesFound: 0,
    status: 'final',
  });
  writeJson(path.join(envGovDir, 'payload-governance.json'), {
    governedArtifact: payloadName, governedHash: payloadSha, architecture: 'payload-centric',
    runId: manifestRunId, sourceFingerprint: manifestFp, status: 'final',
  });

  // ── 5. Attestation Ed25519 ─────────────────────────────────────────────────
  const sigDir = path.join(baseDir, 'dist', 'signatures');
  fs.mkdirSync(sigDir, { recursive: true });
  if (!tamper.skipAttestation) {
    if (tamper.invalidAttestation) {
      // Assina com OUTRA chave (a pública distribuída não corresponde).
      const otherDir = path.join(baseDir, 'keys-other');
      process.env.RAP_RELEASE_KEY_DIR = otherDir;
      ATTESTATION.generateKeyPair({ force: true });
    }
    const attestationFields = {
      releaseId: RELEASE,
      runId: manifestRunId,
      sourceFingerprint: manifestFp,
      gitCommit: COMMIT,
      gitTree: TREE,
      payloadSha256: payloadSha,
      manifestSha256: manifestSha,
      finalDecision: payloadDecision,
      ...(tamper.attestationFieldOverrides || {}),
    };
    const sig = ATTESTATION.signAttestation(attestationFields);
    writeJson(path.join(sigDir, 'release-attestation.sig'), sig);
    process.env.RAP_RELEASE_KEY_DIR = keyDir;
  }

  // ── 6. Chave pública no verifier ───────────────────────────────────────────
  const verDir = path.join(baseDir, 'dist', 'verifier');
  const pubPem = fs.readFileSync(path.join(keyDir, 'release-attestation-public.pem'), 'utf8');
  writeJson(path.join(verDir, 'release-attestation-public-key.json'), {
    artifactType: 'release-attestation-public-key',
    algorithm: 'ed25519',
    publicKey: pubPem,
    publicKeyFingerprint: ATTESTATION.publicKeyFingerprint(pubPem),
  });

  // ── 7. Envelope zip físico (opcional) ──────────────────────────────────────
  // Construído quando o teste precisa validar a higiene do envelope
  // (release_hygiene): verify-result stale, artefato de outro release, etc.
  let envelopePath = null;
  if (tamper.envelopeExtraFiles || tamper.buildEnvelope) {
    const envTree = path.join(baseDir, 'envelope-tree');
    const envReleaseDir = path.join(envTree, 'r-agent2', 'dist', 'release');
    fs.mkdirSync(envReleaseDir, { recursive: true });
    fs.copyFileSync(payloadPath, path.join(envReleaseDir, payloadName));
    fs.copyFileSync(manifestPath, path.join(envReleaseDir, `r-agent2-${RELEASE}.manifest.json`));
    for (const [rel, content] of Object.entries(tamper.envelopeExtraFiles || {})) {
      const target = path.join(envTree, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    envelopePath = path.join(releaseDir, `r-agent2-${RELEASE}.zip`);
    execFileSync('zip', ['-qr', envelopePath, 'r-agent2/'], { cwd: envTree });
  }

  return {
    baseDir,
    releaseId: RELEASE,
    runId: RUN_ID,
    sourceFingerprint: SOURCE_FP,
    gitCommit: COMMIT,
    gitTree: TREE,
    payloadPath,
    payloadSha256: payloadSha,
    manifestPath,
    manifestSha256: manifestSha,
    envelopePath,
    envelopeGovDir: envGovDir,
    signaturesDir: sigDir,
    verifierDir: verDir,
    keyDir,
  };
}

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rap-release-fixture-'));
}

module.exports = { buildReleaseFixture, makeFixtureDir, RELEASE_ID, RUN_ID, SOURCE_FP, GIT_COMMIT, GIT_TREE };

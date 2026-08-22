#!/usr/bin/env node
'use strict';

/**
 * Final Governance Engine — ÚNICA fonte de verdade para decisão de governança.
 *
 * NENHUM outro módulo pode elevar, sobrescrever ou persistir a decisão final
 * sem passar por este engine. Qualquer bloqueio aqui resulta em NO_GO
 * independente do que outros relatórios disserem.
 *
 * Regras de bloqueio inegociáveis (RAP_STRICT_ENTERPRISE_MODE):
 *   1. qa-mesh/go-no-go-report.json = NO_GO          → BLOCK (mesh blocker)
 *   2. qa-mesh/release-gate-report.json = NO_GO       → BLOCK (gate blocker)
 *   3. replay.failedStepCount > 0                     → BLOCK (replay false positive)
 *   4. ui.available = false em jornada visual          → BLOCK (UI unavailable)
 *   5. readiness recalculado diverge do persistido     → WARN  (drift detected)
 *   6. package hash diverge do manifesto               → BLOCK (package tampering)
 *   7. governance signature inválida                   → BLOCK (integrity failure)
 *   8. blocker severity=critical presente              → BLOCK (unresolved blocker)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const {
  assertSourceFreeze,
  readRunContext,
  validateRunContext,
} = require('./shared/run-context');
const {
  gate: authorityGate,
  evaluateMasterScorecard,
  evaluateSelfProof,
  evaluateTamperDetection,
  evaluateFinalProof,
  evaluateFinalReadiness,
} = require('./shared/certification-authority');

const ROOT = path.join(__dirname, '..');

const STRICT_MODE = process.env.RAP_STRICT_ENTERPRISE_MODE !== 'false';

// Jornadas visuais críticas: ui.available DEVE ser true
const VISUAL_CRITICAL_JOURNEYS = new Set([
  'support', 'support_ticket_flow', 'crm', 'ticket', 'whatsapp',
  'omnichannel', 'scheduling', 'payment', 'checkout', 'checkin',
  'handoff', 'human_handoff', 'replay-ui', 'fitness_customer_checkin',
]);

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ─── Verificadores individuais ────────────────────────────────────────────────

function checkMeshGoNoGo() {
  const report = readJsonSafe('qa-mesh/go-no-go-report.json');
  if (!report) {
    return {
      id: 'mesh_go_no_go', pass: false, severity: 'CRITICAL',
      reason: 'qa-mesh/go-no-go-report.json not found',
      hint: 'Run a canonical mesh execution before release',
    };
  }
  const status = report.status || report.gate;
  const pass = status === 'GO';
  return {
    id:         'mesh_go_no_go',
    pass,
    severity:   pass ? 'OK' : 'CRITICAL',
    status,
    reasons:    report.reasons || [],
    executionId: report.executionId || null,
    passRate:   report.totals?.passed != null && report.totals?.total != null
      ? `${report.totals.passed}/${report.totals.total}`
      : null,
    reason: pass ? null : `qa-mesh go-no-go = ${status} (${(report.reasons || []).join(', ')})`,
  };
}

function checkReleaseGate() {
  const report = readJsonSafe('qa-mesh/release-gate-report.json');
  if (!report) return { id: 'release_gate', pass: false, severity: 'CRITICAL', reason: 'release-gate-report not found' };
  const gate = report.gate || report.status;
  const pass = gate === 'GO';
  return {
    id:       'release_gate',
    pass,
    severity: pass ? 'OK' : 'CRITICAL',
    gate,
    reason:   pass ? null : `release-gate = ${gate}`,
  };
}

function checkReplayFalsePositives() {
  const proofSig   = readJsonSafe('governance/proof-signature.json') || {};
  const replays    = proofSig.subjectHashes || [];
  const violations = [];

  // Verificar enterprise replay files
  const replayFiles = [
    'qa/enterprise/omnichannel-unified-replay.json',
    'qa/enterprise/human-handoff-full-validation.json',
    'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  ];

  for (const relPath of replayFiles) {
    const data = readJsonSafe(relPath);
    if (!data) continue;

    // Verificar failedStepCount
    const failedCount = data.failedStepCount ?? 0;
    const status      = data.status || data.go || data.overallStatus;

    if (failedCount > 0 && status === 'GO') {
      violations.push({
        type:           'replay_false_positive',
        file:           relPath,
        failedStepCount: failedCount,
        status,
        message:        `${relPath}: status=GO mas failedStepCount=${failedCount}`,
      });
    }

    // Verificar steps individuais
    const steps = data.steps || data.journeys || data.replays || [];
    if (Array.isArray(steps)) {
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        if (step.status === 'failed' && (data.status === 'GO' || data.go === true)) {
          violations.push({
            type:    'step_failed_but_parent_go',
            file:    relPath,
            stepId:  step.stepId || step.id || '?',
            message: `Failed step em artefato GO: ${relPath}`,
          });
          break;
        }
      }
    }
  }

  // Verificar prod-like smoke journeys
  const prodSmoke = readJsonSafe('qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json') || {};
  const journeys  = prodSmoke.journeys || prodSmoke.results || [];
  if (Array.isArray(journeys)) {
    for (const j of journeys) {
      if (!j) continue;
      const jFailed  = j.failedStepCount ?? 0;
      const jStatus  = j.status || j.go;
      if (jFailed > 0 && jStatus === 'GO') {
        violations.push({
          type:            'journey_false_positive',
          journeyId:       j.journeyId || j.id || '?',
          failedStepCount: jFailed,
          status:          jStatus,
          message:         `journey ${j.journeyId}: status=GO mas failedStepCount=${jFailed}`,
        });
      }
    }
  }

  const pass = violations.length === 0;
  return {
    id:         'replay_false_positives',
    pass,
    severity:   pass ? 'OK' : 'CRITICAL',
    violations,
    reason:     pass ? null : `${violations.length} replay(s) com falso positivo detectado(s)`,
  };
}

function checkVisualJourneys() {
  // Delegar ao replay-hardening-report (que analisa o formato real dos artefatos)
  const hardeningReport = readJsonSafe('governance/replay-hardening-report.json');
  if (hardeningReport) {
    const uiViolations = (hardeningReport.allViolations || [])
      .filter((v) => v.rule?.includes('UI_UNAVAILABLE'));
    const pass = uiViolations.length === 0;
    return {
      id:         'visual_journeys',
      pass,
      severity:   pass ? 'OK' : 'HIGH',
      source:     'replay-hardening-report.json',
      violations: uiViolations,
      reason:     pass ? null : `${uiViolations.length} step(s) com ui.available=false em jornadas visuais críticas`,
    };
  }

  // Fallback: análise direta (superficial)
  const violations = [];
  const checkFiles = [
    'qa/enterprise/human-handoff-full-validation.json',
    'qa/enterprise/omnichannel-unified-replay.json',
  ];

  let checkedArtifacts = 0;
  for (const relPath of checkFiles) {
    const data = readJsonSafe(relPath);
    if (!data) continue;
    checkedArtifacts += 1;

    if (data.ui?.available === false) {
      const jid = data.journeyId || data.id || path.basename(relPath);
      const isVisualCritical = VISUAL_CRITICAL_JOURNEYS.has(jid)
        || [...VISUAL_CRITICAL_JOURNEYS].some((k) => relPath.toLowerCase().includes(k));
      if (isVisualCritical || STRICT_MODE) {
        violations.push({
          type:    'ui_unavailable',
          file:    relPath,
          reason:  data.ui?.reason || 'playwright_page_unavailable',
          message: `${relPath}: ui.available=false mas jornada visual crítica`,
        });
      }
    }

    const steps = data.steps || data.journeys || data.replays || [];
    if (Array.isArray(steps)) {
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        if (step.ui?.available === false) {
          const jid = step.journeyId || step.id || step.stepId || '?';
          if (VISUAL_CRITICAL_JOURNEYS.has(jid) || STRICT_MODE) {
            violations.push({
              type:    'step_ui_unavailable',
              file:    relPath,
              stepId:  jid,
              reason:  step.ui?.reason || 'playwright_page_unavailable',
              message: `step ${jid} em ${relPath}: ui.available=false`,
            });
            break;
          }
        }
      }
    }
  }

  const pass = checkedArtifacts > 0 && violations.length === 0;
  return {
    id:         'visual_journeys',
    pass,
    severity:   pass ? 'OK' : 'HIGH',
    violations,
    reason:     pass ? null : (checkedArtifacts === 0
      ? 'visual journey evidence missing'
      : `${violations.length} jornada(s) visual(is) com UI indisponível`),
  };
}

function checkPackageIntegrity() {
  try {
    // Ler sempre do filesystem (atualizado pelo update-package-binding),
    // nunca do interior do ZIP (que tem o hash da build anterior).
    const pkgReport = readJsonSafe('governance/package-validation-report.json');
    const zipName   = pkgReport?.zipName;
    const recorded  = pkgReport?.zipSha256 || pkgReport?.packageBinding?.sha256;
    const hashSource = 'governance/package-validation-report.json';

    if (!zipName || !recorded) {
      return { id: 'package_integrity', pass: false, severity: 'CRITICAL',
               reason: 'package-validation-report is missing a package hash binding' };
    }

    // Tenta zipPath do relatório, depois dist/release/, depois dist/ direto.
    // O modelo two-pass embrulha o ZIP final como <release>.payload.zip.
    const payloadZipName = zipName.replace(/\.zip$/, '.payload.zip');
    const reportedZipPath = pkgReport?.zipPath && fs.existsSync(pkgReport.zipPath) ? pkgReport.zipPath : null;
    const zipPath = reportedZipPath
      || (fs.existsSync(path.join(ROOT, 'dist', 'release', zipName)) ? path.join(ROOT, 'dist', 'release', zipName) : null)
      || (fs.existsSync(path.join(ROOT, 'dist', 'release', payloadZipName)) ? path.join(ROOT, 'dist', 'release', payloadZipName) : null)
      || path.join(ROOT, 'dist', zipName);
    if (!fs.existsSync(zipPath)) {
      return { id: 'package_integrity', pass: false, severity: 'HIGH',
               reason: `ZIP não encontrado: ${zipName}` };
    }

    const zipHash = sha256File(zipPath);
    const match   = zipHash === recorded;
    return {
      id:        'package_integrity',
      pass:      match,
      severity:  match ? 'OK' : 'CRITICAL',
      zipName,
      computed:  zipHash?.slice(0, 24) + '…',
      recorded:  recorded?.slice(0, 24) + '…',
      hashSource,
      reason:    match ? null : `Package hash diverge [source: ${hashSource}]: computed ≠ recorded`,
    };
  } catch (e) {
    return { id: 'package_integrity', pass: false, severity: 'HIGH', reason: `package integrity error: ${e.message}` };
  }
}

function checkCriticalBlockers() {
  const crossReport = readJsonSafe('governance/cross-report-validation.json');
  const proofReport = readJsonSafe('governance/final-proof-report.json');
  if (!crossReport || !proofReport) {
    return {
      id: 'critical_blockers', pass: false, severity: 'CRITICAL',
      reason: `mandatory blocker sources missing: crossReport=${!!crossReport} proofReport=${!!proofReport}`,
    };
  }

  const blockers  = crossReport.blockers || [];
  const critical  = blockers.filter((b) => b.severity === 'CRITICAL' || b.severity === 'critical');
  const gapCount  = crossReport.blockerCount ?? proofReport.blockerCount ?? 0;

  const pass = critical.length === 0 && gapCount === 0;
  return {
    id:             'critical_blockers',
    pass,
    severity:       pass ? 'OK' : 'CRITICAL',
    criticalCount:  critical.length,
    blockerCount:   gapCount,
    reason:         pass ? null : `${critical.length} blocker(s) crítico(s) não resolvido(s)`,
  };
}

function checkRunContext() {
  try {
    const runContext = assertSourceFreeze({ rootDir: ROOT, stage: 'final-governance' });
    return authorityGate('run_context', true, runContext, null, { runContext });
  } catch (error) {
    let runContext = null;
    try { runContext = readRunContext(ROOT); } catch (_) {}
    return authorityGate(
      'run_context',
      false,
      runContext,
      `${error.code || 'INVALID_RUN_CONTEXT'}: ${error.message}`,
      { runContext },
    );
  }
}

function buildCertificationAuthorityChecks({
  runContext,
  scorecard,
  selfProof,
  tamper,
  proof,
  readiness,
} = {}) {
  return [
    evaluateMasterScorecard(scorecard, runContext),
    evaluateSelfProof(selfProof, runContext),
    evaluateTamperDetection(tamper, runContext),
    evaluateFinalProof(proof, runContext),
    evaluateFinalReadiness(readiness, runContext),
  ];
}

function checkGovernanceSignature() {
  try {
    const { verifySeal } = require('./sign-governance');
    // Localiza governance.sig em ordem de prioridade:
    //   1. governance/ (seal HMAC persistente — não gerenciado por two-pass-release)
    //   2. dist/governance-artifacts/ (staging, presente antes do zip:release)
    //   3. dist/ raiz (compatibilidade com comportamento anterior)
    // dist/signatures/ e dist/governance/ são EXCLUÍDOS — two-pass-release sobrescreve
    // esses locais com manifests SHA256 incompatíveis com verifySeal.
    const govSigPath = path.join(ROOT, 'dist', 'governance.sig');
    const artSigDir  = path.join(ROOT, 'dist', 'governance-artifacts', 'governance.sig');
    const canonSig   = path.join(ROOT, 'governance', 'governance.sig');
    const sigPath = [canonSig, artSigDir, govSigPath].find((p) => fs.existsSync(p)) || govSigPath;
    if (!fs.existsSync(sigPath)) {
      return { id: 'governance_signature', pass: false, severity: 'HIGH', reason: 'governance.sig not found' };
    }
    const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const valid = verifySeal(sig);
    return {
      id:       'governance_signature',
      pass:     valid,
      severity: valid ? 'OK' : 'CRITICAL',
      reason:   valid ? null : 'Governance signature inválida — governança adulterada ou chave diverge',
    };
  } catch (e) {
    return { id: 'governance_signature', pass: false, severity: 'HIGH', reason: e.message };
  }
}

// ─── Motor principal ──────────────────────────────────────────────────────────

function computeFinalDecision(checks, { proofDecision: proofDecOverride } = {}) {
  const criticalFailed = checks.filter((c) => !c.pass && c.severity === 'CRITICAL');
  const highFailed     = checks.filter((c) => !c.pass && c.severity === 'HIGH');
  const warnFailed     = checks.filter((c) => !c.pass && c.severity === 'WARN');

  // Leitura do proof report para nível de readiness (override permite teste puro)
  const hasOverride = Object.prototype.hasOwnProperty.call(arguments[1] || {}, 'proofDecision');
  const proofDec = hasOverride
    ? proofDecOverride
    : (readJsonSafe('governance/final-proof-report.json') || {}).finalDecision;

  if (criticalFailed.length > 0) {
    const reasons = criticalFailed.map((c) => c.reason || c.id).join(' | ');
    return `NO_GO:GOVERNANCE_BLOCKED [${reasons}]`;
  }

  if (STRICT_MODE && highFailed.length > 0) {
    const reasons = highFailed.map((c) => c.reason || c.id).join(' | ');
    return `NO_GO:STRICT_ENTERPRISE [${reasons}]`;
  }

  // Sem blockers críticos: o proof ainda precisa ser explicitamente GO.
  if (proofDec !== 'AUTONOMOUS_READY_GO') {
    return `NO_GO:PROOF_NOT_PASS [proof=${proofDec || 'MISSING'}]`;
  }
  return proofDec;
}

function runGovernanceEngine() {
  const runCheck = checkRunContext();
  const runContext = runCheck.runContext || readRunContext(ROOT);
  const authorityChecks = buildCertificationAuthorityChecks({
    runContext,
    scorecard:  readJsonSafe('governance/rap-master-scorecard.json'),
    selfProof:  readJsonSafe('governance/self-proving-report.json'),
    tamper:     readJsonSafe('governance/tamper-detection-report.json'),
    proof:      readJsonSafe('governance/final-proof-report.json'),
    readiness:  readJsonSafe('governance/final-readiness-report.json'),
  });
  const checks = [
    runCheck,
    ...authorityChecks,
    checkMeshGoNoGo(),
    checkReleaseGate(),
    checkReplayFalsePositives(),
    checkVisualJourneys(),
    checkPackageIntegrity(),
    checkCriticalBlockers(),
    checkGovernanceSignature(),
  ];

  const proofDecision = readJsonSafe('governance/final-proof-report.json')?.finalDecision;
  const finalDecision = computeFinalDecision(checks, { proofDecision });
  const allPass       = checks.every((c) => c.pass);
  const criticals     = checks.filter((c) => !c.pass && c.severity === 'CRITICAL');
  const highs         = checks.filter((c) => !c.pass && (c.severity === 'HIGH' || c.severity === 'WARN'));

  return {
    generatedAt:     new Date().toISOString(),
    engine:          'final-governance-engine/v1',
    artifactType:    'final-governance-report',
    artifactVersion: '2.0.0',
    runId:           runContext?.runId || null,
    sourceFingerprint: runContext?.sourceFingerprint || null,
    strictMode:      STRICT_MODE,
    finalDecision,
    autonomousReady: finalDecision === 'AUTONOMOUS_READY_GO',
    allChecksPass:   allPass,
    criticalBlocked: criticals.length > 0,
    checks,
    criticalFailed:  criticals.map((c) => ({ id: c.id, reason: c.reason })),
    highFailed:      highs.map((c) => ({ id: c.id, reason: c.reason })),
    summary:         allPass
      ? `Governança limpa. Decisão: ${finalDecision}`
      : `${criticals.length} bloqueio(s) crítico(s). Decisão: ${finalDecision}`,
  };
}

module.exports = {
  runGovernanceEngine,
  computeFinalDecision,
  checkMeshGoNoGo,
  checkReleaseGate,
  checkReplayFalsePositives,
  checkVisualJourneys,
  checkPackageIntegrity,
  checkCriticalBlockers,
  checkGovernanceSignature,
  checkRunContext,
  buildCertificationAuthorityChecks,
  VISUAL_CRITICAL_JOURNEYS,
  STRICT_MODE,
};

if (require.main === module) {
  const report  = runGovernanceEngine();
  const outPath = path.join(ROOT, 'governance', 'final-governance-report.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[final-governance-engine] decision=${report.finalDecision} criticals=${report.criticalFailed.length}`);
  process.exit(report.autonomousReady ? 0 : 1);
}

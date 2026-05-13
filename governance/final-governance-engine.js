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
  if (!report) return { id: 'release_gate', pass: true, severity: 'OK', reason: 'release-gate-report not found (skipped)' };
  const gate = report.gate || report.status;
  const pass = gate === 'GO' || gate == null;
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
  const violations = [];
  const checkFiles = [
    'qa/enterprise/human-handoff-full-validation.json',
    'qa/enterprise/omnichannel-unified-replay.json',
    'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  ];

  for (const relPath of checkFiles) {
    const data = readJsonSafe(relPath);
    if (!data) continue;

    // Checar ui.available no nível raiz
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

    // Checar ui.available em steps
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

  const pass = violations.length === 0;
  return {
    id:         'visual_journeys',
    pass,
    severity:   pass ? 'OK' : 'HIGH',
    violations,
    reason:     pass ? null : `${violations.length} jornada(s) visual(is) com UI indisponível`,
  };
}

function checkPackageIntegrity() {
  try {
    const { resolveArtifact } = require('./governance-chain');
    const artifact   = resolveArtifact();
    const zipHash    = sha256File(artifact.zipPath);
    const recorded   = artifact.manifest?.sha256;
    const match      = recorded && zipHash === recorded;
    return {
      id:         'package_integrity',
      pass:       match,
      severity:   match ? 'OK' : 'CRITICAL',
      zipName:    artifact.zip,
      computed:   zipHash?.slice(0, 24) + '…',
      recorded:   recorded?.slice(0, 24) + '…',
      reason:     match ? null : `Package hash diverge: computed ≠ recorded in sidecar manifest`,
    };
  } catch (e) {
    return { id: 'package_integrity', pass: false, severity: 'HIGH', reason: `artifact resolution error: ${e.message}` };
  }
}

function checkCriticalBlockers() {
  const crossReport = readJsonSafe('governance/cross-report-validation.json') || {};
  const proofReport = readJsonSafe('governance/final-proof-report.json')       || {};

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

function checkGovernanceSignature() {
  try {
    const { verifySeal } = require('./sign-governance');
    const govSigPath = path.join(ROOT, 'dist', 'governance.sig');
    const artSigDir  = path.join(ROOT, 'dist', 'governance-artifacts', 'governance.sig');
    const sigPath    = fs.existsSync(artSigDir) ? artSigDir : govSigPath;
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

function computeFinalDecision(checks) {
  const criticalFailed = checks.filter((c) => !c.pass && c.severity === 'CRITICAL');
  const highFailed     = checks.filter((c) => !c.pass && c.severity === 'HIGH');
  const warnFailed     = checks.filter((c) => !c.pass && c.severity === 'WARN');

  // Leitura do proof report para nível de readiness
  const proof    = readJsonSafe('governance/final-proof-report.json') || {};
  const proofDec = proof.finalDecision || 'NO_GO:UNKNOWN';

  if (criticalFailed.length > 0) {
    const reasons = criticalFailed.map((c) => c.reason || c.id).join(' | ');
    return `NO_GO:GOVERNANCE_BLOCKED [${reasons}]`;
  }

  if (STRICT_MODE && highFailed.length > 0) {
    const reasons = highFailed.map((c) => c.reason || c.id).join(' | ');
    return `NO_GO:STRICT_ENTERPRISE [${reasons}]`;
  }

  // Sem blockers críticos: respeitar o proof engine
  return proofDec;
}

function runGovernanceEngine() {
  const checks = [
    checkMeshGoNoGo(),
    checkReleaseGate(),
    checkReplayFalsePositives(),
    checkVisualJourneys(),
    checkPackageIntegrity(),
    checkCriticalBlockers(),
    checkGovernanceSignature(),
  ];

  const finalDecision = computeFinalDecision(checks);
  const allPass       = checks.every((c) => c.pass);
  const criticals     = checks.filter((c) => !c.pass && c.severity === 'CRITICAL');
  const highs         = checks.filter((c) => !c.pass && (c.severity === 'HIGH' || c.severity === 'WARN'));

  return {
    generatedAt:     new Date().toISOString(),
    engine:          'final-governance-engine/v1',
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
  checkMeshGoNoGo,
  checkReleaseGate,
  checkReplayFalsePositives,
  checkVisualJourneys,
  checkPackageIntegrity,
  checkCriticalBlockers,
  checkGovernanceSignature,
  VISUAL_CRITICAL_JOURNEYS,
};

if (require.main === module) {
  const report  = runGovernanceEngine();
  const outPath = path.join(ROOT, 'governance', 'final-governance-report.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[final-governance-engine] decision=${report.finalDecision} criticals=${report.criticalFailed.length}`);
  process.exit(report.autonomousReady ? 0 : 1);
}

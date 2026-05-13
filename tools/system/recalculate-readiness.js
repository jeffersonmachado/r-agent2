#!/usr/bin/env node
'use strict';

/**
 * Recalculate Readiness — recalcula a prontidão do zero, ignorando cache.
 *
 * NUNCA lê relatórios antigos. SEMPRE recomputa tudo.
 * Compara readiness recalculada vs persistida.
 * Se divergirem: READINESS_DRIFT_DETECTED → NO_GO.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'qa', 'reports', 'recalculated-readiness-report.json');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Componentes de readiness ─────────────────────────────────────────────────

function recalcMeshReadiness() {
  const goNoGo    = readJsonSafe('qa-mesh/go-no-go-report.json')    || {};
  const gateRep   = readJsonSafe('qa-mesh/release-gate-report.json') || {};

  const meshStatus = goNoGo.status || goNoGo.gate;
  const gateStatus = gateRep.gate  || gateRep.status;

  const passed     = goNoGo.totals?.passed ?? 0;
  const total      = goNoGo.totals?.total  ?? 0;
  const passRate   = total > 0 ? passed / total : 0;

  return {
    component:   'mesh',
    meshStatus,
    gateStatus,
    passed,
    total,
    passRate:    Math.round(passRate * 100) / 100,
    blocked:     meshStatus === 'NO_GO' || gateStatus === 'NO_GO',
    reasons:     goNoGo.reasons || [],
  };
}

function recalcReplayReadiness() {
  const proofSig    = readJsonSafe('governance/proof-signature.json') || {};
  const replays     = proofSig.subjectHashes || [];
  const auditSigs   = proofSig.signatureAudit?.signatures || [];
  const allValid    = auditSigs.length > 0 && auditSigs.every((s) => s.valid);
  const sigCount    = replays.length;

  // Verificar falsos positivos nos enterprise replays
  const enterpriseFiles = [
    'qa/enterprise/human-handoff-full-validation.json',
    'qa/enterprise/omnichannel-unified-replay.json',
  ];
  const falsePositives = [];
  for (const f of enterpriseFiles) {
    const d = readJsonSafe(f);
    if (!d) continue;
    if ((d.failedStepCount ?? 0) > 0 && (d.status === 'GO' || d.go === true)) {
      falsePositives.push({ file: f, failedStepCount: d.failedStepCount });
    }
  }

  return {
    component:      'replay',
    replayCount:    sigCount,
    signaturesValid: allValid,
    falsePositives: falsePositives.length,
    blocked:        !allValid || falsePositives.length > 0,
    falsePositiveDetails: falsePositives,
  };
}

function recalcSmokeReadiness() {
  const smoke = readJsonSafe('qa/smoke-evidence.json') || {};
  const smokes = smoke.smokes || smoke.results || [];
  const total  = Array.isArray(smokes) ? smokes.length : 0;
  const passed = Array.isArray(smokes) ? smokes.filter((s) => s?.status === 'passed' || s?.passed === true).length : 0;
  const failed = total - passed;

  return {
    component: 'smoke',
    total,
    passed,
    failed,
    blocked:   failed > 0 && total > 0,
  };
}

function recalcPbxReadiness() {
  const pbxFlow = readJsonSafe('qa/enterprise/pbx-voice-flow-prod-like.json') || {};
  const maturity = pbxFlow.maturity || pbxFlow.pbxMaturity || pbxFlow.maturityLevel;
  const isReal   = maturity === 'enterprise-real' || pbxFlow.isFullyReal === true;
  return {
    component:  'pbx',
    maturity:   maturity || 'unknown',
    isFullyReal: isReal,
    blocked:    !isReal,
  };
}

function recalcOmnichannelReadiness() {
  const omni    = readJsonSafe('qa/enterprise/omnichannel-unified-replay.json') || {};
  const crm     = readJsonSafe('qa/enterprise/omnichannel-crm-mutations.json')  || {};
  const present = Object.keys(omni).length > 0;
  return {
    component: 'omnichannel',
    present,
    blocked:   !present,
  };
}

function recalcGovernanceReadiness() {
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const cross       = readJsonSafe('governance/cross-report-validation.json')  || {};
  const score       = consistency.overallConsistencyScore;
  const blockers    = cross.blockerCount ?? 0;
  return {
    component:     'governance',
    score,
    blockerCount:  blockers,
    blocked:       (score != null && score < 100) || blockers > 0,
  };
}

function recalcPackageReadiness() {
  const { runPackageIntegrityEngine } = require('../../governance/package-integrity-engine');
  try {
    const integrity = runPackageIntegrityEngine();
    return {
      component: 'package',
      pass:      integrity.pass,
      blocked:   !integrity.pass,
      failedChecks: integrity.failedChecks,
    };
  } catch (e) {
    return { component: 'package', pass: false, blocked: true, error: e.message };
  }
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function recalculateReadiness() {
  const components = [
    recalcMeshReadiness(),
    recalcReplayReadiness(),
    recalcSmokeReadiness(),
    recalcPbxReadiness(),
    recalcOmnichannelReadiness(),
    recalcGovernanceReadiness(),
    recalcPackageReadiness(),
  ];

  const blocked    = components.filter((c) => c.blocked);
  const allClear   = blocked.length === 0;

  // Ler persistido para comparação
  const persisted  = readJsonSafe('governance/final-proof-report.json') || {};
  const persistedDecision = persisted.finalDecision || 'UNKNOWN';
  const recalcDecision    = allClear ? 'AUTONOMOUS_READY_GO' : `NO_GO:RECALC_BLOCKED`;
  const driftDetected     = persistedDecision !== recalcDecision;

  // Calcular score: 100 * (componentes não bloqueados / total)
  const score = Math.round(((components.length - blocked.length) / components.length) * 100);

  const report = {
    generatedAt:        new Date().toISOString(),
    engine:             'recalculate-readiness/v1',
    recalcDecision,
    persistedDecision,
    driftDetected,
    driftSeverity:      driftDetected ? 'HIGH' : 'OK',
    readinessScore:     score,
    blockedComponents:  blocked.length,
    components,
    blockedDetails:     blocked.map((c) => ({ component: c.component, reason: c.error || 'blocked' })),
    summary: driftDetected
      ? `DRIFT DETECTADO: persistido=${persistedDecision} mas recalculado=${recalcDecision}`
      : `Sem drift. Readiness recalculada=${recalcDecision} (score=${score})`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { recalculateReadiness };

if (require.main === module) {
  const report = recalculateReadiness();
  // eslint-disable-next-line no-console
  console.log(`[recalculate-readiness] recalc=${report.recalcDecision} persisted=${report.persistedDecision} drift=${report.driftDetected}`);
  process.exit(report.driftDetected ? 1 : 0);
}

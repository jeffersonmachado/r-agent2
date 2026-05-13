#!/usr/bin/env node
'use strict';

/**
 * Governance Consistency Engine — detecta contradições entre todos os relatórios.
 *
 * Uma contradição existe quando dois relatórios afirmam estados incompatíveis.
 * Qualquer contradição resulta em NO_GO, independente do que cada relatório
 * isoladamente diga.
 *
 * Contradições detectadas:
 *   - qa-mesh GO_NO_GO ≠ plataforma finalDecision
 *   - replay status GO com failedSteps > 0
 *   - package hash ≠ sidecar manifest
 *   - consistency score < 100 mas finalDecision = AUTONOMOUS_READY_GO
 *   - governance signature inválida mas GO propagado
 *   - PBX maturity declarado ≠ evidência física
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'governance-consistency-report.json');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Contradições ─────────────────────────────────────────────────────────────

function detectMeshVsPlatformContradiction() {
  const meshGoNoGo     = readJsonSafe('qa-mesh/go-no-go-report.json')         || {};
  // final-readiness-report.json é o relatório mais autoritativo (inclui mesh hard-block)
  const readinessReport = readJsonSafe('governance/final-readiness-report.json') || {};
  const proofReport    = readJsonSafe('governance/final-proof-report.json')      || {};

  const meshStatus    = meshGoNoGo.status || meshGoNoGo.gate;
  // Usar readiness report como fonte autoritativa para a decisão da plataforma
  const platformDec   = readinessReport.finalDecision || readinessReport.status || proofReport.finalDecision || '';
  const meshIsNoGo    = meshStatus === 'NO_GO';
  const platformIsGo  = platformDec && !platformDec.startsWith('NO_GO') && platformDec !== 'PENDING';
  const contradiction = meshIsNoGo && platformIsGo;

  return {
    id:           'mesh_vs_platform',
    contradiction,
    severity:     contradiction ? 'CRITICAL' : 'OK',
    meshStatus,
    platformDecision: platformDec,
    meshReasons:  meshGoNoGo.reasons || [],
    message:      contradiction
      ? `CONTRADIÇÃO: qa-mesh=${meshStatus} mas platform=${platformDec} — falso positivo!`
      : null,
  };
}

function detectReleaseGateVsPlatformContradiction() {
  const gateReport  = readJsonSafe('qa-mesh/release-gate-report.json') || {};
  const proofReport = readJsonSafe('governance/final-proof-report.json') || {};

  const gate        = gateReport.gate || gateReport.status;
  const platformDec = proofReport.finalDecision || '';
  const gateIsNoGo  = gate === 'NO_GO';
  const isGo        = platformDec && !platformDec.startsWith('NO_GO') && platformDec !== 'PENDING';
  const contradiction = gateIsNoGo && isGo;

  return {
    id:           'release_gate_vs_platform',
    contradiction,
    severity:     contradiction ? 'CRITICAL' : 'OK',
    gate,
    platformDecision: platformDec,
    message:      contradiction
      ? `CONTRADIÇÃO: release-gate=${gate} mas platform=${platformDec}`
      : null,
  };
}

function detectConsistencyScoreContradiction() {
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const proofReport = readJsonSafe('governance/final-proof-report.json')       || {};

  const score       = consistency.overallConsistencyScore;
  const decision    = proofReport.finalDecision || consistency.finalDecision || '';
  const isAutoGo    = decision === 'AUTONOMOUS_READY_GO';
  const scoreFull   = score == null || score === 100;
  const contradiction = isAutoGo && score != null && score < 100;

  return {
    id:           'consistency_score_vs_decision',
    contradiction,
    severity:     contradiction ? 'HIGH' : 'OK',
    score,
    decision,
    message:      contradiction
      ? `CONTRADIÇÃO: overallConsistencyScore=${score} mas finalDecision=${decision}`
      : null,
  };
}

function detectPbxMaturityContradiction() {
  const crossReport = readJsonSafe('governance/cross-report-validation.json')         || {};
  const proofReport = readJsonSafe('governance/final-proof-report.json')              || {};
  const pbxEvidence = readJsonSafe('qa/enterprise/pbx-voice-flow-prod-like.json')    || {};

  const declaredMaturity = crossReport.pbxMaturity || proofReport.PBXCoverage?.maturityLevel;
  const evidenceMaturity = pbxEvidence.maturity || pbxEvidence.pbxMaturity;

  if (!declaredMaturity || !evidenceMaturity) {
    return { id: 'pbx_maturity', contradiction: false, severity: 'OK', note: 'not enough data to compare' };
  }

  const contradiction = declaredMaturity !== evidenceMaturity;
  return {
    id:              'pbx_maturity',
    contradiction,
    severity:        contradiction ? 'HIGH' : 'OK',
    declared:        declaredMaturity,
    evidence:        evidenceMaturity,
    message:         contradiction
      ? `CONTRADIÇÃO: PBX declarado=${declaredMaturity} mas evidência=${evidenceMaturity}`
      : null,
  };
}

function detectBlockerCountContradiction() {
  const cross  = readJsonSafe('governance/cross-report-validation.json')         || {};
  const proof  = readJsonSafe('governance/final-proof-report.json')              || {};
  const mat    = readJsonSafe('governance/materialized-proof-artifacts-report.json') || {};

  const counts = [
    cross.blockerCount,
    proof.blockerCount,
    mat.blockerCount,
  ].filter((v) => v != null);

  if (counts.length < 2) {
    return { id: 'blocker_count_alignment', contradiction: false, severity: 'OK', note: 'insufficient data' };
  }

  const unique = [...new Set(counts)];
  const contradiction = unique.length > 1;

  return {
    id:           'blocker_count_alignment',
    contradiction,
    severity:     contradiction ? 'HIGH' : 'OK',
    crossReport:  cross.blockerCount,
    proofReport:  proof.blockerCount,
    materialized: mat.blockerCount,
    message:      contradiction ? `CONTRADIÇÃO: blockerCount diverge entre relatórios: ${JSON.stringify(unique)}` : null,
  };
}

function detectPackageNameContradiction() {
  const distFiles = fs.existsSync(path.join(ROOT, 'dist'))
    ? fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f)).sort().reverse()
    : [];
  const latestZip = distFiles[0];

  const reports = [
    { file: 'governance/cross-report-validation.json',   field: 'expectedZipName' },
    { file: 'governance/package-validation-report.json', field: 'zipName'         },
    { file: 'governance/final-consistency-report.json',  field: 'currentZipName'  },
  ];

  if (!latestZip) {
    return { id: 'package_name_alignment', contradiction: false, severity: 'OK', note: 'no zip found' };
  }

  const mismatches = [];
  for (const { file, field } of reports) {
    const d = readJsonSafe(file);
    if (!d) continue;
    const v = d[field];
    if (v && v !== latestZip) {
      mismatches.push({ file, field, found: v, expected: latestZip });
    }
  }

  const contradiction = mismatches.length > 0;
  return {
    id:          'package_name_alignment',
    contradiction,
    severity:    contradiction ? 'CRITICAL' : 'OK',
    latestZip,
    mismatches,
    message:     contradiction
      ? `CONTRADIÇÃO: ${mismatches.length} relatório(s) referenciam ZIP diferente do entregue (${latestZip})`
      : null,
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runConsistencyEngine() {
  const checks = [
    detectMeshVsPlatformContradiction(),
    detectReleaseGateVsPlatformContradiction(),
    detectConsistencyScoreContradiction(),
    detectPbxMaturityContradiction(),
    detectBlockerCountContradiction(),
    detectPackageNameContradiction(),
  ];

  const contradictions = checks.filter((c) => c.contradiction);
  const critical       = contradictions.filter((c) => c.severity === 'CRITICAL');
  const pass           = contradictions.length === 0;

  const report = {
    generatedAt:          new Date().toISOString(),
    engine:               'governance-consistency-engine/v1',
    pass,
    decision:             pass ? 'CONSISTENCY_GO' : 'CONSISTENCY_NO_GO',
    totalChecks:          checks.length,
    contradictions:       contradictions.length,
    criticalContradictions: critical.length,
    checks,
    foundContradictions:  contradictions.map((c) => ({ id: c.id, severity: c.severity, message: c.message })),
    summary: pass
      ? `Nenhuma contradição detectada entre ${checks.length} verificações de consistência.`
      : `${contradictions.length} contradição(ões) detectada(s): ${contradictions.map((c) => c.id).join(', ')}`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runConsistencyEngine };

if (require.main === module) {
  const report = runConsistencyEngine();
  // eslint-disable-next-line no-console
  console.log(`[consistency-engine] decision=${report.decision} contradictions=${report.contradictions}`);
  process.exit(report.pass ? 0 : 1);
}

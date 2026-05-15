#!/usr/bin/env node
'use strict';

/**
 * Generate Self-Proving Report — gera o pacote de auto-prova enterprise.
 *
 * Consolida todos os hashes de todos os artefatos críticos em um único relatório
 * imutável que pode ser verificado de forma independente.
 *
 * Saída: qa/reports/final-self-proving-report.json
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'qa', 'reports', 'final-self-proving-report.json');

function sha256File(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function sha256Object(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function findLatestZip() {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) return null;
  const zips = fs.readdirSync(distDir)
    .filter((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f))
    .sort().reverse();
  return zips[0] || null;
}

function generateSelfProvingReport() {
  const zipName = findLatestZip();
  const zipHash = zipName ? sha256File(`dist/${zipName}`) : null;

  // Hashes dos artefatos de governança
  const manifestHash       = sha256File('governance/evidence-manifest.json');
  const replayHash         = sha256File('governance/replay-hardening-report.json');
  const governanceHash     = sha256File('governance/final-governance-report.json');
  const readinessHash      = sha256File('governance/final-readiness-report.json');
  const consistencyHash    = sha256File('governance/replay-consistency-report.json');
  const contaminationHash  = sha256File('governance/report-contamination-report.json');
  const driftHash          = sha256File('governance/readiness-drift-report.json');
  const packageIntegrityHash = sha256File('governance/package-integrity-report.json');
  const gateHash           = sha256File('governance/final-consistency-gate-report.json');

  // Decisões dos engines
  const hardeningReport    = readJsonSafe('governance/replay-hardening-report.json')       || {};
  const consistReport      = readJsonSafe('governance/replay-consistency-report.json')     || {};
  const contamReport       = readJsonSafe('governance/report-contamination-report.json')   || {};
  const integrityReport    = readJsonSafe('governance/package-integrity-report.json')      || {};
  const govReport          = readJsonSafe('governance/final-governance-report.json')       || {};
  const readinessReport    = readJsonSafe('governance/final-readiness-report.json')        || {};
  const driftReport        = readJsonSafe('governance/readiness-drift-report.json')        || {};
  const gateReport         = readJsonSafe('governance/final-consistency-gate-report.json') || {};

  // Recalculated readiness hash (hash da decisão recalculada online)
  let recalcHash = null;
  try {
    const { computeReadiness } = require('./shared/readiness-decision-engine');
    const recalc = computeReadiness(ROOT);
    recalcHash = sha256Object({ decision: recalc.decision, blockers: recalc.blockers });
  } catch (_) {}

  const engineDecisions = {
    replayHardening:    hardeningReport.decision   || 'UNKNOWN',
    replayConsistency:  consistReport.decision     || 'UNKNOWN',
    contamination:      contamReport.decision      || 'UNKNOWN',
    packageIntegrity:   integrityReport.decision   || 'UNKNOWN',
    finalGovernance:    govReport.finalDecision    || 'UNKNOWN',
    readiness:          readinessReport.finalDecision || readinessReport.status || 'UNKNOWN',
    readinessDrift:     driftReport.decision       || 'UNKNOWN',
    finalConsistencyGate: gateReport.decision      || 'UNKNOWN',
  };

  const allNoGo = Object.values(engineDecisions).every((d) =>
    d.startsWith('NO_GO') || d === 'UNKNOWN' || d === 'GOVERNANCE_CONTAMINATION_NO_GO' || d === 'READINESS_DRIFT_NO_GO' || d === 'FINAL_CONSISTENCY_NO_GO'
  );
  const packageOk = engineDecisions.packageIntegrity === 'PACKAGE_INTEGRITY_GO';

  const report = {
    generatedAt:               new Date().toISOString(),
    engine:                    'generate-self-proving-report/v1',
    // Artefatos do pacote
    zipName:                   zipName,
    zipHash,
    // Hashes dos relatórios de governança
    manifestHash,
    replayHash,
    governanceHash,
    readinessHash,
    consistencyHash,
    contaminationHash,
    packageIntegrityHash,
    driftHash,
    gateHash,
    // Hash da readiness recalculada online
    recalculatedReadinessHash: recalcHash,
    // Decisões por engine
    engineDecisions,
    // Status geral
    packageIntegrityOk: packageOk,
    allEnginesBlockedOrUnknown: allNoGo,
    autonomousReady: Object.values(engineDecisions).every((d) => d === 'AUTONOMOUS_READY_GO' || d.includes('_GO') && !d.includes('NO_GO') && !d.includes('CONTAMINATION') && !d.includes('DRIFT') && !d.includes('CONSISTENCY_NO')),
    summary: `Self-proving report gerado. ZIP: ${zipName || 'ausente'}. Package: ${packageOk ? 'ÍNTEGRO' : 'DIVERGENTE'}.`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { generateSelfProvingReport };

if (require.main === module) {
  const report = generateSelfProvingReport();
  // eslint-disable-next-line no-console
  console.log(`[self-proving-report] zip=${report.zipName} packageOk=${report.packageIntegrityOk} autonomousReady=${report.autonomousReady}`);
  process.exit(0);
}

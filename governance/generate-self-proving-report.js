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

// ─── Decisões de GO por engine — vocabulário explícito, nunca substring ──────
// Cada validador obrigatório tem um conjunto fechado de decisões que contam
// como prova válida. Qualquer outra decisão (NO_GO, UNKNOWN, estágio
// intermediário como PRODLIKE_GO, vocabulário novo) é falha de validador.
const ENGINE_GO_DECISIONS = {
  replayHardening:      ['REPLAY_HARDENING_GO'],
  replayConsistency:    ['REPLAY_CONSISTENCY_GO'],
  contamination:        ['NO_CONTAMINATION'],
  packageIntegrity:     ['PACKAGE_INTEGRITY_GO'],
  finalGovernance:      ['AUTONOMOUS_READY_GO'],
  readiness:            ['AUTONOMOUS_READY_GO'],
  readinessDrift:       ['READINESS_NO_DRIFT'],
  finalConsistencyGate: ['FINAL_CONSISTENCY_GO'],
};

function isEngineGo(engine, decision) {
  const allowed = ENGINE_GO_DECISIONS[engine];
  return Array.isArray(allowed) && allowed.includes(decision);
}

/**
 * autonomousReady deriva dos resultados reais dos validadores: TODOS os
 * engines obrigatórios com decisão de GO explícita. Nunca heurística de
 * substring sobre o texto da decisão.
 */
function deriveAutonomousReady(engineDecisions) {
  return Object.keys(ENGINE_GO_DECISIONS).every((engine) => isEngineGo(engine, engineDecisions[engine]));
}

/**
 * Lista os validadores obrigatórios que NÃO estão em decisão de GO explícita.
 * Usado para o exit code do CLI: qualquer falha → exit não-zero.
 */
function collectMandatoryFailures(engineDecisions, packageOk) {
  const failures = Object.keys(ENGINE_GO_DECISIONS)
    .filter((engine) => !isEngineGo(engine, engineDecisions[engine]))
    .map((engine) => ({ engine, decision: engineDecisions[engine] }));
  if (!packageOk) failures.push({ engine: 'packageIntegrity.zipBinding', decision: 'ZIP_HASH_NOT_BOUND' });
  return failures;
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

  // Derivação real: autonomousReady e falhas obrigatórias vêm do vocabulário
  // fechado de decisões GO por engine (nunca de match de substring).
  const autonomousReady    = deriveAutonomousReady(engineDecisions);
  const mandatoryFailures  = collectMandatoryFailures(engineDecisions, packageOk);

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
    autonomousReady,
    // FASE 16 — falha explícita de validador obrigatório
    mandatoryFailures,
    ok: mandatoryFailures.length === 0,
    summary: `Self-proving report gerado. ZIP: ${zipName || 'ausente'}. Package: ${packageOk ? 'ÍNTEGRO' : 'DIVERGENTE'}. Validadores falhos: ${mandatoryFailures.length}.`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = {
  generateSelfProvingReport,
  deriveAutonomousReady,
  collectMandatoryFailures,
  isEngineGo,
  ENGINE_GO_DECISIONS,
};

if (require.main === module) {
  const report = generateSelfProvingReport();
  // eslint-disable-next-line no-console
  console.log(`[self-proving-report] zip=${report.zipName} packageOk=${report.packageIntegrityOk} autonomousReady=${report.autonomousReady} failures=${report.mandatoryFailures.length}`);
  // Exit não-zero quando qualquer validador obrigatório falha — o relatório
  // deriva dos resultados reais dos validadores, nunca de exit 0 incondicional.
  process.exit(report.ok ? 0 : 1);
}

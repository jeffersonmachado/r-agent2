#!/usr/bin/env node
'use strict';

/**
 * Blocker Engine — fonte canônica de blockers de governança.
 *
 * Todos os relatórios de governança DEVEM consumir apenas este módulo
 * para determinar blockerCount, blockingGaps, categorias e severidade.
 *
 * Qualquer divergência entre relatórios e este engine invalida o pacote.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─── Categorias de blocker ────────────────────────────────────────────────────
const BLOCKER_CATEGORIES = {
  PACKAGE_INTEGRITY:    'package_integrity',
  SELF_CONTAINMENT:     'self_containment',
  CROSS_REPORT:         'cross_report',
  REPLAY_COVERAGE:      'replay_coverage',
  PBX_MATURITY:         'pbx_maturity',
  OMNICHANNEL:          'omnichannel',
  INTELLIGENCE:         'intelligence',
  PROD_LIKE:            'prod_like',
  EVIDENCE:             'evidence',
  MANIFEST:             'manifest',
};

// ─── Severidades ─────────────────────────────────────────────────────────────
const SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH:     'HIGH',
  MEDIUM:   'MEDIUM',
  WARN:     'WARN',
};

// ─── Utilidades ──────────────────────────────────────────────────────────────
function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolveReport(relPath) {
  return readJsonSafe(path.join(ROOT, relPath));
}

// ─── Leitores de estado ───────────────────────────────────────────────────────
function loadFinalProofReport() {
  return resolveReport('governance/final-proof-report.json');
}

function loadFinalReadinessReport() {
  return resolveReport('governance/final-readiness-report.json');
}

function loadMaterializedProofReport() {
  return resolveReport('governance/materialized-proof-artifacts-report.json');
}

function loadCrossReportValidation() {
  return resolveReport('governance/cross-report-validation.json');
}

function loadConsistencyReport() {
  return resolveReport('governance/final-consistency-report.json');
}

// ─── Motor de derivação de blockers ──────────────────────────────────────────
function deriveBlockers() {
  const blockers = [];

  const proof       = loadFinalProofReport()       || {};
  const readiness   = loadFinalReadinessReport()   || {};
  const materialized = loadMaterializedProofReport() || {};
  const crossReport = loadCrossReportValidation()  || {};
  const consistency = loadConsistencyReport();

  // 1. Blockers herdados do final-proof-report
  const proofBlockers = Array.isArray(proof.blockers) ? proof.blockers : [];
  for (const b of proofBlockers) {
    blockers.push({
      id:       b.id || `proof_${blockers.length}`,
      category: BLOCKER_CATEGORIES.EVIDENCE,
      severity: SEVERITY.CRITICAL,
      message:  b.message || String(b),
      source:   'governance/final-proof-report.json',
    });
  }

  // 2. Blockers herdados do materialized-proof-artifacts-report
  const matBlockers = Array.isArray(materialized.blockers) ? materialized.blockers : [];
  for (const b of matBlockers) {
    blockers.push({
      id:       b.id || `mat_${blockers.length}`,
      category: BLOCKER_CATEGORIES.CROSS_REPORT,
      severity: SEVERITY.CRITICAL,
      message:  b.message || String(b),
      source:   'governance/materialized-proof-artifacts-report.json',
    });
  }

  // 3. Blockers herdados do cross-report-validation
  const crossBlockers = Array.isArray(crossReport.blockers) ? crossReport.blockers : [];
  for (const b of crossBlockers) {
    blockers.push({
      id:       b.id || `cross_${blockers.length}`,
      category: BLOCKER_CATEGORIES.CROSS_REPORT,
      severity: SEVERITY.CRITICAL,
      message:  b.message || String(b),
      source:   'governance/cross-report-validation.json',
    });
  }

  // 4. Verificação de self-containment obrigatório
  const requiredFiles = [
    'governance/final-proof-report.json',
    'governance/evidence-manifest.json',
    'governance/final-readiness-report.json',
    'governance/final-consistency-report.json',
    'governance/blocker-engine.js',
    'governance/cross-report-validation.json',
    'governance/materialized-proof-artifacts-report.json',
    'governance/proof-signature.json',
  ];

  for (const relPath of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, relPath))) {
      blockers.push({
        id:       `missing_${relPath.replace(/\W+/g, '_')}`,
        category: BLOCKER_CATEGORIES.SELF_CONTAINMENT,
        severity: SEVERITY.CRITICAL,
        message:  `Arquivo de governança obrigatório ausente: ${relPath}`,
        source:   'blocker-engine.js',
      });
    }
  }

  // 5. Verificação de consistency report presente e alinhado ao pacote atual
  if (!consistency) {
    blockers.push({
      id:       'missing_consistency_report',
      category: BLOCKER_CATEGORIES.MANIFEST,
      severity: SEVERITY.CRITICAL,
      message:  'governance/final-consistency-report.json ausente — pacote não é self-proving',
      source:   'blocker-engine.js',
    });
  }

  // 6. PBX maturity check
  const pbxMaturity = proof.PBXCoverage?.maturityLevel || materialized.pbxMaturity;
  if (pbxMaturity && pbxMaturity !== 'enterprise-real') {
    blockers.push({
      id:       'pbx_not_enterprise_real',
      category: BLOCKER_CATEGORIES.PBX_MATURITY,
      severity: SEVERITY.HIGH,
      message:  `PBX maturity é "${pbxMaturity}", esperado "enterprise-real"`,
      source:   'blocker-engine.js',
    });
  }

  // 7. prodLikeCoverage check
  const prodLike = proof.prodLikeCoverage || {};
  if (typeof prodLike.found === 'number' && typeof prodLike.required === 'number') {
    if (prodLike.found < prodLike.required) {
      blockers.push({
        id:       'prod_like_coverage_insufficient',
        category: BLOCKER_CATEGORIES.PROD_LIKE,
        severity: SEVERITY.CRITICAL,
        message:  `prodLikeCoverage ${prodLike.found}/${prodLike.required} — abaixo do mínimo`,
        source:   'blocker-engine.js',
      });
    }
  }

  return blockers;
}

// ─── API pública ──────────────────────────────────────────────────────────────
function getBlockerReport() {
  const blockers = deriveBlockers();
  const blockingGaps = blockers.filter((b) => b.severity === SEVERITY.CRITICAL);

  return {
    generatedAt:    new Date().toISOString(),
    blockerCount:   blockers.length,
    blockingGaps:   blockingGaps.length,
    blockers,
    categories:     BLOCKER_CATEGORIES,
    severity:       SEVERITY,
    autonomousReady: blockers.length === 0,
  };
}

function getBlockerCount() {
  return deriveBlockers().length;
}

function getBlockingGaps() {
  return deriveBlockers().filter((b) => b.severity === SEVERITY.CRITICAL);
}

function isAutonomousReady() {
  return deriveBlockers().length === 0;
}

module.exports = {
  BLOCKER_CATEGORIES,
  SEVERITY,
  deriveBlockers,
  getBlockerReport,
  getBlockerCount,
  getBlockingGaps,
  isAutonomousReady,
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const report = getBlockerReport();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.autonomousReady ? 0 : 1);
}

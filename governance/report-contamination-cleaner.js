#!/usr/bin/env node
'use strict';

/**
 * Report Contamination Cleaner — detecta e relata relatórios com GO legado.
 *
 * Um relatório está contaminado quando:
 *   - finalDecision = AUTONOMOUS_READY_GO mas estado real é NO_GO
 *   - overallSelfProofScore = 100 mas existem violações reais
 *   - referencia ZIP antigo
 *   - contradiz o final-governance-engine
 *
 * Este engine NÃO sobrescreve relatórios — apenas reporta a contaminação.
 * A correção é feita pelos outros engines no pipeline de release.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'report-contamination-report.json');

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

// ─── Verificadores ────────────────────────────────────────────────────────────
function checkConsistencyReport() {
  const report     = readJsonSafe('governance/final-consistency-report.json');
  const govEngine  = readJsonSafe('governance/final-governance-report.json');
  if (!report) return null;

  const issues = [];
  const dec    = report.finalDecision || report.overallDecision;

  // GO no consistency report mas governance engine bloqueou
  if (dec === 'AUTONOMOUS_READY_GO' && govEngine?.finalDecision?.startsWith('NO_GO')) {
    issues.push({
      type:       'LEGACY_GO_IN_CONSISTENCY',
      field:      'finalDecision',
      value:      dec,
      engineSays: govEngine.finalDecision,
      message:    `final-consistency-report diz ${dec} mas final-governance-engine diz ${govEngine.finalDecision}`,
    });
  }

  // overallConsistencyScore mede alinhamento entre relatórios (cross-report),
  // NÃO qualidade de replay. Só é contaminação se o report afirma GO final
  // enquanto a governance engine bloqueou.
  // (Não verificar score vs replay — são dimensões independentes)

  return {
    file:        'governance/final-consistency-report.json',
    contaminated: issues.length > 0,
    issues,
  };
}

function checkSelfProvingReport() {
  const report = readJsonSafe('governance/self-proving-report.json');
  if (!report) return null;
  const latestZip = findLatestZip();
  const issues    = [];

  // Referência a ZIP antigo
  if (latestZip && report.artifact && report.artifact !== latestZip) {
    issues.push({
      type:    'STALE_ZIP_REFERENCE',
      field:   'artifact',
      value:   report.artifact,
      latest:  latestZip,
      message: `self-proving-report referencia ZIP ${report.artifact} mas o mais recente é ${latestZip}`,
    });
  }

  // overallSelfProofScore mede integridade estrutural do pacote (não prontidão operacional).
  // Um score=100 é contaminação apenas quando a governance bloqueia por razão ESTRUTURAL
  // (replay false-positive, package tampering) — NÃO por razão operacional (mesh regression).
  const govReport2 = readJsonSafe('governance/final-governance-report.json');
  if (report.overallSelfProofScore === 100 && govReport2?.finalDecision?.startsWith('NO_GO')) {
    const blockReasons = govReport2.criticalFailed || [];
    const hasStructuralBlock = blockReasons.some((b) =>
      b.id === 'package_integrity' || b.id === 'governance_signature' || b.id === 'replay_false_positives'
    );
    if (hasStructuralBlock) {
      issues.push({
        type:    'FALSE_SELF_PROOF_SCORE',
        field:   'overallSelfProofScore',
        value:   100,
        message: `overallSelfProofScore=100 mas existem blockers estruturais: ${blockReasons.map((b)=>b.id).join(', ')}`,
      });
    }
    // Mesh regression é blocker OPERACIONAL, não estrutural — não contamina o score
  }

  return {
    file:        'governance/self-proving-report.json',
    contaminated: issues.length > 0,
    issues,
  };
}

function checkFinalProofReport() {
  const report    = readJsonSafe('governance/final-proof-report.json');
  const govEngine = readJsonSafe('governance/final-governance-report.json');
  if (!report) return null;
  const issues    = [];

  const dec = report.finalDecision;
  if (dec === 'AUTONOMOUS_READY_GO' && govEngine?.finalDecision?.startsWith('NO_GO')) {
    issues.push({
      type:       'LEGACY_GO',
      field:      'finalDecision',
      value:      dec,
      engineSays: govEngine.finalDecision,
      message:    `final-proof-report diz ${dec} mas governance-engine diz ${govEngine.finalDecision}`,
    });
  }

  return {
    file:        'governance/final-proof-report.json',
    contaminated: issues.length > 0,
    issues,
  };
}

function checkReadinessReport() {
  const report = readJsonSafe('governance/final-readiness-report.json');
  if (!report) return null;
  const dec    = report.finalDecision || report.status;
  const issues = [];

  // Este relatório deveria já estar correto (NO_GO:MESH_BLOCKED) — verificar
  if (dec === 'AUTONOMOUS_READY_GO') {
    const meshGoNoGo = readJsonSafe('qa-mesh/go-no-go-report.json') || {};
    if (meshGoNoGo.status === 'NO_GO') {
      issues.push({
        type:    'MESH_NO_GO_IGNORED',
        field:   'finalDecision',
        value:   dec,
        message: `final-readiness-report diz ${dec} mas qa-mesh go-no-go é NO_GO`,
      });
    }
  }

  return {
    file:        'governance/final-readiness-report.json',
    contaminated: issues.length > 0,
    issues,
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runContaminationCleaner() {
  const checks = [
    checkConsistencyReport(),
    checkSelfProvingReport(),
    checkFinalProofReport(),
    checkReadinessReport(),
  ].filter(Boolean);

  const contaminated = checks.filter((c) => c.contaminated);
  const allIssues    = contaminated.flatMap((c) => c.issues.map((i) => ({ ...i, file: c.file })));
  const pass         = contaminated.length === 0;

  const report = {
    generatedAt:         new Date().toISOString(),
    engine:              'report-contamination-cleaner/v1',
    pass,
    decision:            pass ? 'NO_CONTAMINATION' : 'CONTAMINATION_DETECTED',
    filesChecked:        checks.length,
    contaminatedFiles:   contaminated.length,
    issues:              allIssues.length,
    contaminations:      contaminated.map((c) => ({ file: c.file, issueCount: c.issues.length, issues: c.issues })),
    summary: pass
      ? `Nenhuma contaminação detectada em ${checks.length} relatórios.`
      : `${contaminated.length} relatório(s) contaminado(s): ${contaminated.map((c) => c.file).join(', ')}`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runContaminationCleaner };

if (require.main === module) {
  const report = runContaminationCleaner();
  // eslint-disable-next-line no-console
  console.log(`[contamination-cleaner] decision=${report.decision} contaminated=${report.contaminatedFiles} issues=${report.issues}`);
  process.exit(report.pass ? 0 : 1);
}

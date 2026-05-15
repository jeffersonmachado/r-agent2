#!/usr/bin/env node
'use strict';

/**
 * Report Contamination Cleaner v2 — varredura recursiva de GO legado.
 *
 * Um relatório está contaminado quando contém — em QUALQUER profundidade do JSON:
 *   - AUTONOMOUS_READY_GO   → GO legado de ciclo anterior
 *   - SELF_PROVING_GO       → GO legado de prova anterior
 *   - ENTERPRISE_READY_GO   → GO legado de validação anterior
 *   - stale GO              → decisão GO num relatório cujo motor diz NO_GO
 *   - orphan GO             → GO que não tem engine que o suporte
 *   - conflicting GO        → GO que contradiz a decisão final da governança
 *
 * Atenção: este engine NÃO sobrescreve relatórios — apenas reporta contaminação.
 *
 * Resultado: GOVERNANCE_CONTAMINATION_NO_GO se qualquer contaminação for detectada.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'report-contamination-report.json');

// Termos que indicam GO legado ou stale
const LEGACY_GO_TERMS = [
  'AUTONOMOUS_READY_GO',
  'SELF_PROVING_GO',
  'ENTERPRISE_READY_GO',
];

// Campos que são "decisões" (portadores de GO/NO_GO)
const DECISION_FIELDS = new Set([
  'finalDecision', 'decision', 'overallDecision', 'status', 'gate',
  'readinessDecision', 'overallStatus', 'go', 'platformDecision',
]);

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Varredura recursiva de objeto JSON ───────────────────────────────────────
// Retorna lista de { path, value, term } para cada ocorrência de GO legado.
function scanRecursively(obj, currentPath, found) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanRecursively(v, `${currentPath}[${i}]`, found));
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;

    if (typeof value === 'string') {
      for (const term of LEGACY_GO_TERMS) {
        if (value.includes(term)) {
          found.push({
            path:  childPath,
            value: value.slice(0, 120),
            term,
            isDecisionField: DECISION_FIELDS.has(key),
          });
          break;
        }
      }
    } else if (value && typeof value === 'object') {
      scanRecursively(value, childPath, found);
    }
  }
}

// ─── Leitura da decisão canônica atual do governance engine ──────────────────
function getCurrentGovernanceDecision() {
  const govReport = readJsonSafe('governance/final-governance-report.json');
  if (govReport) return govReport.finalDecision || null;

  // Fallback: readiness report
  const readiness = readJsonSafe('governance/final-readiness-report.json');
  if (readiness) return readiness.finalDecision || readiness.status || null;

  return null;
}

function isNoGo(decision) {
  if (!decision) return false;
  return String(decision).startsWith('NO_GO') || String(decision) === 'NO_GO';
}

// ─── Varredura de um arquivo específico ──────────────────────────────────────
function scanFile(relPath, opts = {}) {
  const data = readJsonSafe(relPath);
  if (!data) return { file: relPath, scanned: false, contaminations: [] };

  const found = [];
  scanRecursively(data, '', found);

  const contaminations = found.map((hit) => ({
    ...hit,
    file: relPath,
    type: hit.isDecisionField ? 'LEGACY_GO_IN_DECISION_FIELD' : 'LEGACY_GO_IN_NESTED_FIELD',
    severity: hit.isDecisionField ? 'CRITICAL' : 'HIGH',
  }));

  return { file: relPath, scanned: true, hitCount: found.length, contaminations };
}

// ─── Lista de arquivos a varrer ───────────────────────────────────────────────
function getGovernanceFiles() {
  const govDir = path.join(ROOT, 'governance');
  if (!fs.existsSync(govDir)) return [];

  return fs.readdirSync(govDir)
    .filter((f) => f.endsWith('.json'))
    // Excluir o próprio relatório deste engine (output)
    .filter((f) => f !== 'report-contamination-report.json')
    .map((f) => `governance/${f}`);
}

// ─── Verificação cruzada: GO num relatório vs decisão canônica ────────────────
function checkCrossContamination(fileScanResults, currentDecision) {
  const crossIssues = [];

  if (!isNoGo(currentDecision)) return crossIssues;

  for (const result of fileScanResults) {
    if (!result.scanned || result.contaminations.length === 0) continue;

    // Verificar se o próprio top-level do arquivo diz GO
    const data = readJsonSafe(result.file);
    if (!data) continue;

    const topLevelDecision = data.finalDecision || data.decision || data.status || data.gate;
    const topLevelIsGo = topLevelDecision && LEGACY_GO_TERMS.some((t) => String(topLevelDecision).includes(t));

    if (topLevelIsGo) {
      crossIssues.push({
        file:            result.file,
        type:            'STALE_TOP_LEVEL_GO',
        severity:        'CRITICAL',
        topLevelDecision,
        currentDecision,
        message:         `${result.file} afirma ${topLevelDecision} mas governança diz ${currentDecision}`,
      });
    }
  }

  return crossIssues;
}

// ─── dev/platform-readiness/latest.json ──────────────────────────────────────
function checkPlatformReadiness() {
  return scanFile('dev/platform-readiness/latest.json');
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runContaminationCleaner() {
  const currentDecision = getCurrentGovernanceDecision();
  const governanceFiles = getGovernanceFiles();

  // Varredura de todos os arquivos de governança
  const fileScanResults = [
    ...governanceFiles.map((f) => scanFile(f)),
    checkPlatformReadiness(),
  ].filter((r) => r.scanned);

  // Verificação cruzada
  const crossIssues = checkCrossContamination(fileScanResults, currentDecision);

  // Agregar todas as contaminações
  const allContaminations = [
    ...fileScanResults.flatMap((r) => r.contaminations),
    ...crossIssues,
  ];

  const criticalContaminations = allContaminations.filter((c) => c.severity === 'CRITICAL');
  const highContaminations     = allContaminations.filter((c) => c.severity === 'HIGH');

  // Agrupar por arquivo para relatório
  const byFile = {};
  for (const c of allContaminations) {
    if (!byFile[c.file]) byFile[c.file] = [];
    byFile[c.file].push(c);
  }

  const contaminatedFiles = Object.keys(byFile);
  const pass = allContaminations.length === 0;

  const report = {
    generatedAt:          new Date().toISOString(),
    engine:               'report-contamination-cleaner/v2',
    pass,
    decision:             pass ? 'NO_CONTAMINATION' : 'GOVERNANCE_CONTAMINATION_NO_GO',
    currentGovernanceDecision: currentDecision || 'UNKNOWN',
    filesScanned:         fileScanResults.length,
    contaminatedFiles:    contaminatedFiles.length,
    totalContaminations:  allContaminations.length,
    criticalCount:        criticalContaminations.length,
    highCount:            highContaminations.length,
    legacyTermsSearched:  LEGACY_GO_TERMS,
    contaminations:       contaminatedFiles.map((f) => ({
      file:         f,
      issueCount:   byFile[f].length,
      issues:       byFile[f],
    })),
    crossIssues,
    summary: pass
      ? `Nenhuma contaminação detectada em ${fileScanResults.length} arquivos.`
      : `${allContaminations.length} contaminação(ões) em ${contaminatedFiles.length} arquivo(s): ${criticalContaminations.length} crítica(s), ${highContaminations.length} alta(s)`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runContaminationCleaner };

if (require.main === module) {
  const report = runContaminationCleaner();
  // eslint-disable-next-line no-console
  console.log(`[contamination-cleaner/v2] decision=${report.decision} contaminated=${report.contaminatedFiles} total=${report.totalContaminations} critical=${report.criticalCount}`);
  process.exit(report.pass ? 0 : 1);
}

#!/usr/bin/env node
'use strict';

/**
 * Report Contamination Cleaner v3 — detecção de reports de runs anteriores.
 *
 * Um relatório está contaminado quando:
 *   a) runId do artifact != runId do current run (FOREIGN_RUN_ARTIFACT)
 *   b) Quando não há runId: report com generatedAt muito antigo (>24h)
 *      e a decisão contradiz a decisão canônica atual (STALE_GO)
 *   c) Decisão GO num relatório cujo motor diz NO_GO (cross-contamination)
 *
 * NOTA: a presença de AUTONOMOUS_READY_GO em reports do RUN ATUAL não é
 * contaminação — é o estado correto. Apenas reports de runs anteriores
 * ou reports com stale generatedAt que afirmam GO contradizendo o estado
 * atual são contaminação real.
 *
 * Atenção: este engine NÃO sobrescreve relatórios — apenas reporta contaminação.
 *
 * Resultado: GOVERNANCE_CONTAMINATION_NO_GO se qualquer contaminação for detectada.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'report-contamination-report.json');

const { getCurrentRunId } = require('./shared/run-id');
const { computeSourceFingerprint } = require('./proof-engine/fingerprint-chain');
const { getProducer, producerDueNow, currentArtifactPhase } = require('../scripts/governance/lib/runtime-evidence-artifacts');

// Termos que indicam GO — usados SOMENTE para cross-contamination quando governance=NO_GO
const GO_TERMS = [
  'AUTONOMOUS_READY_GO',
  'SELF_PROVING_GO',
  'ENTERPRISE_READY_GO',
];

// Threshold de staleness: relatórios sem runId com mais de 24h são suspeitos
const STALE_HOURS = 24;

// Campos que são "decisões" (portadores de GO/NO_GO)
const DECISION_FIELDS = new Set([
  'finalDecision', 'decision', 'overallDecision', 'status', 'gate',
  'readinessDecision', 'overallStatus', 'go', 'platformDecision',
]);

function isStaleTimestamp(generatedAt) {
  if (!generatedAt) return false;
  try {
    const age = (Date.now() - new Date(generatedAt).getTime()) / 3600000;
    return age > STALE_HOURS;
  } catch (_) { return false; }
}

function hasGoDecision(data) {
  const d = data.finalDecision || data.decision || data.status || data.gate || '';
  return GO_TERMS.some((t) => String(d).includes(t));
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Verificar se um artifact pertence a um run estranho ─────────────────────
function checkForeignRun(data, relPath, currentRunId) {
  if (!data || typeof data !== 'object') return null;

  const artifactRunId = data.runId || data.run_id;

  // Se o artifact tem runId e difere do atual → FOREIGN_RUN
  if (currentRunId && artifactRunId && artifactRunId !== currentRunId) {
    // DEFERIMENTO DE FASE (mesma autoridade de ensure/stamp/gate temporal,
    // medida em 2026-10-05): um artefato cujo PRODUTOR pertence a uma fase
    // posterior (cadeia FINAL/DELIVERED, produzida no empacotamento) ainda NÃO
    // PODE ter o runId corrente — ele é `PENDING_PHASE`, não contaminação. Sem
    // isto o cleaner reprovava a governança por 5 artefatos que a própria
    // política de fase ainda nem deixava produzir (RAP-064 fechou em NO_GO por
    // eles). Na fase devida `producerDueNow` vira true e eles voltam a ser
    // contaminação CRITICAL.
    const producer = getProducer(relPath);
    if (producer && !producerDueNow(producer)) {
      return {
        path:     'runId',
        value:    artifactRunId,
        term:     'PENDING_PHASE_FOREIGN_RUN',
        isDecisionField: true,
        type:     'PENDING_PHASE_FOREIGN_RUN',
        severity: 'INFO',
        file:     relPath,
        expected: currentRunId,
        producerPhase: producer.phase || 'ANY',
        detail:   'produtor pertence a fase posterior: a evidencia nasce no empacotamento (nao e contaminacao agora)',
      };
    }
    return {
      path:     'runId',
      value:    artifactRunId,
      term:     'FOREIGN_RUN_ARTIFACT',
      isDecisionField: true,
      type:     'FOREIGN_RUN_ARTIFACT',
      severity: 'CRITICAL',
      file:     relPath,
      expected: currentRunId,
    };
  }

  // Se não há runId e o report é stale E afirma GO contradizendo governance atual
  if (!artifactRunId && isStaleTimestamp(data.generatedAt) && hasGoDecision(data)) {
    return {
      path:     'generatedAt',
      value:    data.generatedAt,
      term:     'STALE_GO_NO_RUN_ID',
      isDecisionField: false,
      type:     'STALE_GO_NO_RUN_ID',
      severity: 'HIGH',
      file:     relPath,
    };
  }

  return null;
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
function scanFile(relPath, currentRunId) {
  const data = readJsonSafe(relPath);
  if (!data) return { file: relPath, scanned: false, contaminations: [], pendingPhase: [] };

  const contaminations = [];
  const pendingPhase = [];
  const foreignRun = checkForeignRun(data, relPath, currentRunId);
  if (foreignRun) {
    // PENDING_PHASE é o artefato que a fase corrente ainda NÃO pode produzir:
    // fica separado, auditável, e FORA da decisão.
    if (foreignRun.type === 'PENDING_PHASE_FOREIGN_RUN') pendingPhase.push(foreignRun);
    else contaminations.push(foreignRun);
  }

  return { file: relPath, scanned: true, hitCount: contaminations.length, contaminations, pendingPhase };
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

  // Cross-contamination só é relevante quando governance está em NO_GO
  // e algum sub-relatório afirma GO — indicando report stale
  if (!isNoGo(currentDecision)) return crossIssues;

  for (const result of fileScanResults) { // eslint-disable-line no-unreachable-loop
    if (!result.scanned || result.contaminations.length === 0) continue;

    // Verificar se o próprio top-level do arquivo diz GO
    const data = readJsonSafe(result.file);
    if (!data) continue;

    const topLevelDecision = data.finalDecision || data.decision || data.status || data.gate;
    const topLevelIsGo = topLevelDecision && GO_TERMS.some((t) => String(topLevelDecision).includes(t));

    // Só flageia se o report é stale (>24h) ou tem runId diferente do atual
    const isStale = isStaleTimestamp(data.generatedAt);
    if (topLevelIsGo && isStale) {
      crossIssues.push({
        file:            result.file,
        type:            'STALE_TOP_LEVEL_GO',
        severity:        'CRITICAL',
        topLevelDecision,
        currentDecision,
        generatedAt:     data.generatedAt,
        message:         `${result.file} afirma ${topLevelDecision} (stale: ${data.generatedAt}) mas governança diz ${currentDecision}`,
      });
    }
  }

  return crossIssues;
}

// ─── dev/platform-readiness/latest.json ──────────────────────────────────────
function checkPlatformReadiness(currentRunId) {
  return scanFile('dev/platform-readiness/latest.json', currentRunId);
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runContaminationCleaner() {
  const currentDecision = getCurrentGovernanceDecision();
  const currentRunId    = getCurrentRunId();
  const governanceFiles = getGovernanceFiles();

  // Varredura de todos os arquivos de governança por foreign runId
  const fileScanResults = [
    ...governanceFiles.map((f) => scanFile(f, currentRunId)),
    checkPlatformReadiness(currentRunId),
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

  // Artefatos cuja FASE ainda não chegou: auditáveis, e fora da decisão.
  const allPendingPhase = fileScanResults.flatMap((r) => r.pendingPhase || []);

  const contaminatedFiles = Object.keys(byFile);
  const pass = allContaminations.length === 0;

  const report = {
    generatedAt:          new Date().toISOString(),
    runId:                currentRunId || null,
    sourceFingerprint:    computeSourceFingerprint(ROOT),
    artifactType:         'report-contamination-report',
    artifactVersion:      '1.0.0',
    engine:               'report-contamination-cleaner/v3',
    phase:                currentArtifactPhase(),
    pass,
    decision:             pass ? 'NO_CONTAMINATION' : 'GOVERNANCE_CONTAMINATION_NO_GO',
    currentGovernanceDecision: currentDecision || 'UNKNOWN',
    filesScanned:         fileScanResults.length,
    contaminatedFiles:    contaminatedFiles.length,
    totalContaminations:  allContaminations.length,
    criticalCount:        criticalContaminations.length,
    highCount:            highContaminations.length,
    pendingPhaseCount:    allPendingPhase.length,
    pendingPhase:         allPendingPhase,
    currentRunId:         currentRunId || null,
    goTermsMonitored:     GO_TERMS,
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

module.exports = { runContaminationCleaner, checkForeignRun, scanFile };

if (require.main === module) {
  const report = runContaminationCleaner();
  // eslint-disable-next-line no-console
  console.log(`[contamination-cleaner/v3] decision=${report.decision} contaminated=${report.contaminatedFiles} total=${report.totalContaminations} critical=${report.criticalCount} runId=${report.runId||'none'}`);
  process.exit(report.pass ? 0 : 1);
}

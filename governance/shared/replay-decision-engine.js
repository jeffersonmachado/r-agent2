'use strict';

/**
 * Replay Decision Engine — ÚNICA fonte de decisão de replay.
 *
 * Todos os módulos que precisam saber "o replay passou ou não" DEVEM usar este módulo.
 * Nenhum engine pode calcular a decisão de replay de forma independente.
 *
 * Hierarquia de fontes (ordem de autoridade):
 *   1. replay-hardening-report.json  — análise profunda (steps, UI, hashes)
 *   2. replay-semantic-validator     — validação semântica online (se report ausente)
 *   3. replay-parser                 — dados brutos normalizados
 *
 * Saída canônica por jornada:
 *   { journeyId, decision: 'GO'|'NO_GO', violations[], source }
 *
 * Saída global:
 *   { pass, decision: 'REPLAY_GO'|'REPLAY_NO_GO', perJourney[], allViolations[] }
 */

const fs   = require('fs');
const path = require('path');
const { loadAllReplays }          = require('./replay-parser');
const { validateAllReplays }      = require('./replay-semantic-validator');
const { loadVisualCriticalJourneys } = require('../replay-hardening-engine');

const ROOT = path.join(__dirname, '..', '..');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Decisão a partir do replay-hardening-report (fonte preferencial) ─────────
function decideFromHardeningReport() {
  const report = readJsonSafe('governance/replay-hardening-report.json');
  if (!report) return null;

  // Registros hash-only (assinatura de hash sem evidência de execução) não
  // carregam verificação determinística — não geram decisão GO/NO_GO de
  // replay e ficam fora do perJourney (a decisão da jornada, se existir,
  // vem dos artefatos online). Ver buildHashOnlyRecord no hardening engine.
  const perJourney = (report.results || [])
    .filter((r) => !r.hashOnly)
    .map((r) => ({
      journeyId:  r.journeyId,
      decision:   r.hardened ? 'GO' : 'NO_GO',
      violations: r.violations || [],
      source:     'replay-hardening-report.json',
      hashOnly:   r.hashOnly || false,
    }));

  const allViolations = (report.allViolations || []);
  const pass          = report.pass === true;

  return {
    pass,
    decision:    pass ? 'REPLAY_GO' : 'REPLAY_NO_GO',
    perJourney,
    allViolations,
    source:      'replay-hardening-report.json',
    reportedAt:  report.generatedAt,
  };
}

// ─── Decisão online a partir dos artefatos brutos ────────────────────────────
function decideFromArtifacts() {
  const VISUAL_CRITICAL = loadVisualCriticalJourneys();
  const replays         = loadAllReplays(ROOT);
  const result          = validateAllReplays(replays, VISUAL_CRITICAL);

  const perJourney = result.perJourney.map((j) => ({
    journeyId:  j.journeyId,
    decision:   j.valid ? 'GO' : 'NO_GO',
    violations: j.violations,
    source:     j.source || 'artifacts',
  }));

  return {
    pass:         result.pass,
    decision:     result.pass ? 'REPLAY_GO' : 'REPLAY_NO_GO',
    perJourney,
    allViolations: result.violations,
    source:       'artifacts-online',
  };
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Retorna a decisão canônica de replay.
 * Usa hardening-report se disponível; recalcula a partir dos artefatos caso contrário.
 * @param {{ forceRecalc?: boolean }} opts
 */
function getReplayDecision(opts) {
  if (!opts?.forceRecalc) {
    const fromReport = decideFromHardeningReport();
    if (fromReport) return fromReport;
  }
  return decideFromArtifacts();
}

/**
 * Retorna a decisão de uma jornada específica.
 * @param {string} journeyId
 * @param {{ forceRecalc?: boolean }} opts
 */
function getJourneyDecision(journeyId, opts) {
  const global = getReplayDecision(opts);
  return global.perJourney.find((j) => j.journeyId === journeyId) || null;
}

/**
 * Verifica se a decisão de hardening e a decisão online (artefatos) são coerentes.
 * Retorna divergências por jornada.
 */
function checkReplayDecisionConsistency() {
  const fromReport    = decideFromHardeningReport();
  const fromArtifacts = decideFromArtifacts();

  if (!fromReport) {
    return {
      consistent: true,
      note:       'replay-hardening-report ausente — apenas artefatos analisados',
      divergences: [],
    };
  }

  // Indexar por journeyId
  const reportIndex    = Object.fromEntries(fromReport.perJourney.map((j) => [j.journeyId, j]));
  const artifactIndex  = Object.fromEntries(fromArtifacts.perJourney.map((j) => [j.journeyId, j]));

  const allJourneys = new Set([
    ...Object.keys(reportIndex),
    ...Object.keys(artifactIndex),
  ]);

  const divergences = [];
  for (const jid of allJourneys) {
    const r = reportIndex[jid];
    const a = artifactIndex[jid];
    if (!r || !a) continue;
    if (r.decision !== a.decision) {
      divergences.push({
        journeyId:       jid,
        reportDecision:  r.decision,
        artifactDecision: a.decision,
        severity:        'HIGH',
        message:         `${jid}: hardening-report diz ${r.decision} mas artefatos dizem ${a.decision}`,
      });
    }
  }

  // Decisão global também deve coincidir
  const globalDivergence = fromReport.decision !== fromArtifacts.decision;

  return {
    consistent:          divergences.length === 0 && !globalDivergence,
    globalReport:        fromReport.decision,
    globalArtifacts:     fromArtifacts.decision,
    globalDivergence,
    divergences,
    journeysCompared:    allJourneys.size,
  };
}

module.exports = { getReplayDecision, getJourneyDecision, checkReplayDecisionConsistency, decideFromArtifacts, decideFromHardeningReport };

'use strict';

const fs = require('fs');
const path = require('path');

// Override por env permite hermetizar testes (ver meshRunner.test.js), evitando
// que execuções sintéticas poluam o índice real de histórico.
const HISTORY_DIR = process.env.QA_MESH_STABILITY_HISTORY_DIR || path.join(__dirname, 'history');
const INDEX_PATH = path.join(HISTORY_DIR, 'index.json');

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    return { entries: [], snapshots: [] };
  }
}

function saveIndex(index) {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  } catch {
    // silencioso — histórico não é crítico para o fluxo de execução
  }
}

/**
 * toSnapshotPoint — ponto da série temporal no formato consumido pela UI
 * (StabilityPage → GET /qa/stability/history → history.snapshots[]):
 * { generatedAt, file, stabilityScore, releaseReadiness, failures }.
 * `date`/`executionId` são mantidos para auditoria e dedupe.
 */
function toSnapshotPoint(snapshot, date, filename) {
  const global = snapshot.global || {};
  return {
    date,
    file: filename,
    executionId: snapshot.executionId || null,
    generatedAt: snapshot.generatedAt || null,
    stabilityScore: global.stabilityScore ?? snapshot.successRate ?? null,
    releaseReadiness: global.releaseReadiness ?? null,
    failures: Array.isArray(snapshot.failures) ? snapshot.failures.length : (snapshot.failed ?? 0),
  };
}

/**
 * persistStabilitySnapshot — persiste um snapshot de estabilidade no histórico local.
 * O index.json mantém DUAS visões dos mesmos pontos:
 * - entries[]:    { date, file, executionId } — formato legado (compat);
 * - snapshots[]:  série temporal rica consumida pela StabilityPage.
 * Decisão (2026-09-03): manter ambos no index em vez de mapear entries→snapshots
 * no qaMeshService, porque entries antigas não carregam stabilityScore/
 * releaseReadiness/failures — o mapeamento no service produziria pontos vazios.
 * Retorna o índice atualizado com as últimas entradas.
 */
function persistStabilitySnapshot(snapshot) {
  if (!snapshot) return { entries: [], snapshots: [] };

  const index = loadIndex();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `stability-${date}.json`;
  const filePath = path.join(HISTORY_DIR, filename);

  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { existing = []; }
    if (!Array.isArray(existing)) existing = [];
    existing.push(snapshot);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
  } catch {
    // silencioso
  }

  const entry = { date, file: filename, executionId: snapshot.executionId || null };
  const point = toSnapshotPoint(snapshot, date, filename);
  if (!index.entries) index.entries = [];
  if (!index.snapshots) index.snapshots = [];
  // evita duplicação por executionId
  const exists = index.entries.some((e) => e.executionId && e.executionId === entry.executionId);
  if (!exists) {
    index.entries.unshift(entry);
    if (index.entries.length > 90) index.entries = index.entries.slice(0, 90);
  }
  const pointExists = index.snapshots.some((p) => p.executionId && p.executionId === point.executionId);
  if (!pointExists) {
    index.snapshots.unshift(point);
    if (index.snapshots.length > 90) index.snapshots = index.snapshots.slice(0, 90);
  }
  if (!exists || !pointExists) {
    saveIndex(index);
  }

  return index;
}

module.exports = { persistStabilitySnapshot };

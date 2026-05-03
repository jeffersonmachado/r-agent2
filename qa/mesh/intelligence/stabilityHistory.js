'use strict';

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, 'history');
const INDEX_PATH = path.join(HISTORY_DIR, 'index.json');

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch {
    return { entries: [] };
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
 * persistStabilitySnapshot — persiste um snapshot de estabilidade no histórico local.
 * Retorna o índice atualizado com as últimas entradas.
 */
function persistStabilitySnapshot(snapshot) {
  if (!snapshot) return { entries: [] };

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
  if (!index.entries) index.entries = [];
  // evita duplicação por executionId
  const exists = index.entries.some((e) => e.executionId && e.executionId === entry.executionId);
  if (!exists) {
    index.entries.unshift(entry);
    if (index.entries.length > 90) index.entries = index.entries.slice(0, 90);
    saveIndex(index);
  }

  return index;
}

module.exports = { persistStabilitySnapshot };

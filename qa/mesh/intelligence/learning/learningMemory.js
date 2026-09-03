'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const MEMORY_PATH = path.join(ROOT, 'qa', 'mesh', 'intelligence', 'learning', 'learningMemory.json');

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function updateLearningMemory(payload) {
  const current = safeReadJson(MEMORY_PATH, {
    generatedAt: null,
    stats: {
      detected: 0,
      clustered: 0,
      prioritized: 0,
      suggested: 0,
      planned: 0,
      patched: 0,
      validated: 0,
      promoted: 0,
      rejected: 0,
    },
    entries: [],
  });

  const entries = Array.isArray(current.entries) ? current.entries : [];
  const timestamp = new Date().toISOString();

  for (const item of payload || []) {
    entries.unshift({
      ...item,
      updatedAt: timestamp,
    });
  }

  const stats = {
    detected: entries.length,
    clustered: entries.filter((entry) => entry.state === 'clustered' || entry.clusterId).length,
    prioritized: entries.filter((entry) => entry.priorityScore != null).length,
    suggested: entries.filter((entry) => entry.suggestionType).length,
    planned: entries.filter((entry) => entry.plan).length,
    patched: entries.filter((entry) => entry.patchStatus === 'patched-dry-run' || entry.patchStatus === 'patched').length,
    validated: entries.filter((entry) => entry.validationStatus === 'validated').length,
    promoted: entries.filter((entry) => entry.promotionDecision === 'promoted').length,
    rejected: entries.filter((entry) => entry.promotionDecision === 'rejected').length,
  };

  const output = {
    generatedAt: timestamp,
    stats,
    entries: entries.slice(0, 400),
  };

  fs.writeFileSync(MEMORY_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  updateLearningMemory,
  MEMORY_PATH,
};

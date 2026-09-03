'use strict';

const fs = require('fs');

const { learnPath } = require('./paths');

const OUTPUT_PATH = learnPath('failures.normalized.json');

function compact(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFailure(item) {
  const moduleName = item.domain || 'core';
  const type = (item.failureType || item.status || 'failure').toLowerCase();
  const error = compact(item.errorMessage || item.rootCauseHint || item.id || 'unknown').toLowerCase();
  const signature = `${moduleName}.${type}.${error.replace(/[^a-z0-9]+/g, '.').slice(0, 80)}`;
  return {
    signature,
    module: moduleName,
    vertical: moduleName,
    channel: moduleName.includes('pbx') ? 'pbx' : moduleName.includes('whatsapp') ? 'whatsapp' : moduleName.includes('chat') ? 'chat' : 'api',
    type,
    criticality: item.criticality || 'medium',
    frequency: 1,
    replayConsistent: item.status === 'flaky' ? false : true,
    firstSeenAt: item.startedAt || null,
    lastSeenAt: item.finishedAt || null,
    sampleError: compact(item.errorMessage || item.rootCauseHint || ''),
    scenarioId: item.id,
  };
}

function normalizeFailures(execution, history = []) {
  const grouped = new Map();
  const source = [...history, execution].filter(Boolean);

  for (const run of source) {
    for (const item of run.results || []) {
      if (item.status === 'passed' || item.status === 'passed_via_fallback') continue;
      const normalized = normalizeFailure(item);
      const current = grouped.get(normalized.signature) || normalized;
      current.frequency += grouped.has(normalized.signature) ? 1 : 0;
      current.firstSeenAt = current.firstSeenAt || normalized.firstSeenAt;
      current.lastSeenAt = normalized.lastSeenAt || current.lastSeenAt;
      current.replayConsistent = current.replayConsistent && normalized.replayConsistent;
      grouped.set(normalized.signature, current);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    total: grouped.size,
    items: Array.from(grouped.values()).sort((a, b) => b.frequency - a.frequency),
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  normalizeFailures,
  OUTPUT_PATH,
};

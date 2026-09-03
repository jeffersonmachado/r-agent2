'use strict';

const fs = require('fs');

const { learnPath } = require('./paths');

const OUTPUT_PATH = learnPath('failures.clustered.json');

function probableCause(item) {
  const type = String(item.type || '').toLowerCase();
  if (type.includes('timeout') || type.includes('infra')) return 'runtime-timing';
  if (type.includes('auth') || type.includes('permission')) return 'access-control';
  if (type.includes('selector') || type.includes('semantic')) return 'ui-selector';
  if (type.includes('flaky')) return 'state-nondeterminism';
  return 'functional-contract';
}

function clusterFailures(normalized) {
  const clusters = new Map();
  for (const item of normalized.items || []) {
    const key = `${item.module}::${item.type}::${probableCause(item)}`;
    const current = clusters.get(key) || {
      clusterId: `cluster-${clusters.size + 1}`,
      key,
      module: item.module,
      type: item.type,
      probableCause: probableCause(item),
      signatures: [],
      totalFrequency: 0,
      criticality: 'low',
      items: [],
    };
    current.signatures.push(item.signature);
    current.items.push(item);
    current.totalFrequency += Number(item.frequency || 0);
    if (item.criticality === 'blocking' || item.criticality === 'high') current.criticality = 'high';
    else if (current.criticality !== 'high' && item.criticality === 'medium') current.criticality = 'medium';
    clusters.set(key, current);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    totalClusters: clusters.size,
    clusters: Array.from(clusters.values()).sort((a, b) => b.totalFrequency - a.totalFrequency),
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  clusterFailures,
  OUTPUT_PATH,
};

'use strict';

const fs = require('fs');

const { learnPath } = require('./paths');

const OUTPUT_PATH = learnPath('failures.ranked.json');

function criticalityWeight(value) {
  if (value === 'high' || value === 'blocking') return 100;
  if (value === 'medium') return 60;
  return 30;
}

function rankImpacts(clustered) {
  const ranked = (clustered.clusters || []).map((cluster) => {
    const releaseBlocking = cluster.criticality === 'high' ? 100 : 40;
    const criticalFlowImpact = cluster.items.some((item) => item.criticality === 'blocking') ? 100 : 50;
    const recurrence = Math.min(100, cluster.totalFrequency * 10);
    const frequency = Math.min(100, cluster.totalFrequency * 8);
    const score =
      (criticalityWeight(cluster.criticality) * 0.35) +
      (frequency * 0.20) +
      (criticalFlowImpact * 0.25) +
      (releaseBlocking * 0.20);

    return {
      clusterId: cluster.clusterId,
      module: cluster.module,
      probableCause: cluster.probableCause,
      criticality: cluster.criticality,
      totalFrequency: cluster.totalFrequency,
      recurrence,
      priorityScore: Number(score.toFixed(2)),
      signatures: cluster.signatures,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const output = {
    generatedAt: new Date().toISOString(),
    totalRanked: ranked.length,
    ranked,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return output;
}

module.exports = {
  rankImpacts,
  OUTPUT_PATH,
};

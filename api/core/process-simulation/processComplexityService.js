'use strict';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class ProcessComplexityService {
  calculateComplexity({ nodeCount = 0, edgeCount = 0, loopCount = 0, branchingNodes = 0, unreachableNodeCount = 0 } = {}) {
    const score = (
      safeNumber(nodeCount) * 1
      + safeNumber(edgeCount) * 0.75
      + safeNumber(loopCount) * 6
      + safeNumber(branchingNodes) * 3
      + safeNumber(unreachableNodeCount) * 2
    );

    return {
      score,
      level: score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low',
      factors: {
        nodeCount: safeNumber(nodeCount),
        edgeCount: safeNumber(edgeCount),
        loopCount: safeNumber(loopCount),
        branchingNodes: safeNumber(branchingNodes),
        unreachableNodeCount: safeNumber(unreachableNodeCount),
      },
    };
  }
}

module.exports = {
  ProcessComplexityService,
};

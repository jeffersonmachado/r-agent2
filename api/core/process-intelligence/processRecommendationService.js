'use strict';

class ProcessRecommendationService {
  buildRecommendations({ compiledProcess, analytics = null, simulation = null, gaps = [] } = {}) {
    const recommendations = [];
    const nodes = Array.isArray(compiledProcess?.nodes) ? compiledProcess.nodes : [];

    gaps.forEach((gap) => {
      if (gap.type === 'missing_fallback') {
        recommendations.push({
          type: 'add_fallback',
          nodeId: gap.nodeId,
          priority: 'high',
          message: `Add fallback handling to ${gap.nodeId}.`,
        });
      }
      if (gap.type === 'high_complexity') {
        recommendations.push({
          type: 'split_subprocess',
          nodeId: null,
          priority: 'medium',
          message: 'Split the process into smaller subprocesses to reduce complexity.',
        });
      }
    });

    nodes.forEach((node) => {
      if (node.type === 'gateway.exclusive') {
        const edges = compiledProcess.executionGraph?.edgesBySource?.[String(node.id)] || [];
        if (edges.length > 3) {
          recommendations.push({
            type: 'consolidate_gateway',
            nodeId: node.id,
            priority: 'medium',
            message: `Gateway ${node.id} has many branches and should be simplified.`,
          });
        }
      }
      if (node.type === 'task.ai' && node.config?.promptTemplate && !node.config?.ruleName) {
        recommendations.push({
          type: 'replace_ai_by_rule',
          nodeId: node.id,
          priority: 'low',
          message: `Review if ${node.id} can be replaced by a deterministic rule.`,
        });
      }
      if (node.type === 'task.service' && node.config?.ruleName) {
        recommendations.push({
          type: 'replace_rule_by_ai',
          nodeId: node.id,
          priority: 'low',
          message: `Review if ${node.id} could benefit from AI-based classification.`,
        });
      }
    });

    if ((simulation?.complexityScore || 0) > 25) {
      recommendations.push({
        type: 'reduce_timeout',
        nodeId: null,
        priority: 'low',
        message: 'Review timeout policies and branching depth to reduce total duration.',
      });
    }

    return recommendations;
  }
}

module.exports = {
  ProcessRecommendationService,
};

'use strict';

class ProcessGapAnalysisService {
  analyze({ compiledProcess, analytics = null, simulation = null } = {}) {
    const gaps = [];
    const nodes = Array.isArray(compiledProcess?.nodes) ? compiledProcess.nodes : [];

    nodes.forEach((node) => {
      if (node.type === 'task.ai') {
        const outgoing = compiledProcess.executionGraph?.edgesBySource?.[String(node.id)] || [];
        const hasFallback = outgoing.some((edge) => {
          const port = String(edge?.metadata?.sourcePort || '').toLowerCase();
          return port.includes('fallback') || port.includes('error');
        });
        if (!hasFallback) {
          gaps.push({
            type: 'missing_fallback',
            nodeId: node.id,
            severity: 'warning',
            message: `Node ${node.id} should expose an explicit fallback path.`,
          });
        }
      }
    });

    if ((simulation?.complexityScore || 0) >= 40) {
      gaps.push({
        type: 'high_complexity',
        nodeId: null,
        severity: 'warning',
        message: 'Process complexity is high and should be reduced.',
      });
    }

    const bottlenecks = Array.isArray(analytics?.bottlenecks) ? analytics.bottlenecks : [];
    bottlenecks.slice(0, 3).forEach((item) => {
      gaps.push({
        type: 'bottleneck',
        nodeId: item.nodeId,
        severity: 'info',
        message: `Node ${item.nodeId} is a bottleneck candidate.`,
      });
    });

    return gaps;
  }
}

module.exports = {
  ProcessGapAnalysisService,
};

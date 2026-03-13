'use strict';

class ProcessBottleneckService {
  identifyBottlenecks(nodeMetrics = [], limit = 5) {
    return (Array.isArray(nodeMetrics) ? nodeMetrics : [])
      .slice()
      .sort((a, b) => Number(b.averageDurationMs || 0) - Number(a.averageDurationMs || 0))
      .slice(0, Math.max(1, Number(limit) || 5))
      .map((metric) => ({
        nodeId: metric.nodeId,
        nodeType: metric.nodeType || null,
        averageDurationMs: Number(metric.averageDurationMs || 0),
        entries: Number(metric.entries || 0),
        exits: Number(metric.exits || 0),
        errors: Number(metric.errors || 0),
        fallbacks: Number(metric.fallbacks || 0),
      }));
  }
}

module.exports = {
  ProcessBottleneckService,
};

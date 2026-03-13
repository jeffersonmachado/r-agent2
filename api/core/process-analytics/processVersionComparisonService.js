'use strict';

class ProcessVersionComparisonService {
  compareVersions(currentAnalytics = {}, previousAnalytics = {}) {
    const current = currentAnalytics?.process || {};
    const previous = previousAnalytics?.process || {};

    return {
      currentVersion: current.version || null,
      previousVersion: previous.version || null,
      delta: {
        totalExecutions: Number(current.totalExecutions || 0) - Number(previous.totalExecutions || 0),
        successRate: Number(current.successRate || 0) - Number(previous.successRate || 0),
        failureRate: Number(current.failureRate || 0) - Number(previous.failureRate || 0),
        averageDurationMs: Number(current.averageDurationMs || 0) - Number(previous.averageDurationMs || 0),
        p95DurationMs: Number(current.p95DurationMs || 0) - Number(previous.p95DurationMs || 0),
      },
    };
  }
}

module.exports = {
  ProcessVersionComparisonService,
};

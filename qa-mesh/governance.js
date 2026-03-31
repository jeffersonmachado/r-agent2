'use strict';

const MIN_EXECUTION_RATIO = 0.7;

function buildDomainSummary(results = []) {
  return results.reduce((acc, item) => {
    const domain = item.domain || 'core';
    if (!acc[domain]) {
      acc[domain] = { passed: 0, failed: 0, skipped: 0, infra_error: 0, environment_missing: 0, flaky: 0, total: 0 };
    }
    acc[domain].total += 1;
    if (item.status === 'passed') acc[domain].passed += 1;
    else if (item.status === 'failed') acc[domain].failed += 1;
    else if (item.status === 'infra_error') acc[domain].infra_error += 1;
    else if (item.status === 'environment_missing') acc[domain].environment_missing += 1;
    else if (item.status === 'flaky') acc[domain].flaky += 1;
    else acc[domain].skipped += 1;
    return acc;
  }, {});
}

function summarizeResults(results = [], registryTotal = results.length) {
  const attempted = results.length;
  const passed = results.filter((item) => item.status === 'passed').length;
  const failed = results.filter((item) => item.status === 'failed').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const infraErrors = results.filter((item) => item.status === 'infra_error').length;
  const environmentMissing = results.filter((item) => item.status === 'environment_missing').length;
  const flaky = results.filter((item) => item.status === 'flaky').length;
  const executed = passed + failed + infraErrors + environmentMissing + flaky;
  const executionCoverage = registryTotal > 0 ? executed / registryTotal : 0;

  return {
    registryTotal,
    attempted,
    executed,
    passed,
    failed,
    skipped,
    infraErrors,
    environmentMissing,
    flaky,
    executionCoverage,
    executionQuality: registryTotal > 0 && executionCoverage >= MIN_EXECUTION_RATIO && attempted > 0 ? 'valid' : 'invalid',
    domains: buildDomainSummary(results),
  };
}

function evaluateGoNoGo(results = [], options = {}) {
  const criticalDomains = new Set(options.criticalDomains || ['core', 'pbx', 'omnichannel']);
  const maxFailureRate = Number.isFinite(options.maxFailureRate) ? options.maxFailureRate : 0.2;
  const registryTotal = Number.isFinite(options.registryTotal) ? options.registryTotal : results.length;
  const summary = summarizeResults(results, registryTotal);
  const reasons = [];

  if (summary.attempted === 0) {
    reasons.push('NO_SCENARIOS_EXECUTED');
  }

  if (summary.executionCoverage < MIN_EXECUTION_RATIO) {
    reasons.push('INSUFFICIENT_COVERAGE');
  }

  if (results.some((item) => item.status === 'failed' && item.criticality === 'blocking')) {
    reasons.push('BLOCKING_SCENARIO_FAILED');
  }

  const failureRate = summary.executed > 0 ? (summary.failed + summary.infraErrors + summary.environmentMissing + summary.flaky) / summary.executed : 1;
  if (summary.executed > 0 && failureRate > maxFailureRate) {
    reasons.push('FAILURE_RATE_ABOVE_THRESHOLD');
  }

  for (const [domain, domainSummary] of Object.entries(summary.domains)) {
    if (
      criticalDomains.has(domain) &&
      (domainSummary.failed > 0 || domainSummary.infra_error > 0 || domainSummary.environment_missing > 0 || domainSummary.flaky > 0)
    ) {
      reasons.push(`CRITICAL_DOMAIN_FAILED:${domain}`);
    }
  }

  return {
    goNoGo: reasons.length === 0 ? 'GO' : 'NO_GO',
    reasons,
    registryTotal: summary.registryTotal,
    attempted: summary.attempted,
    executed: summary.executed,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    infraErrors: summary.infraErrors,
    environmentMissing: summary.environmentMissing,
    flaky: summary.flaky,
    executionCoverage: summary.executionCoverage,
    executionQuality: summary.executionQuality,
    domains: summary.domains,
    thresholds: {
      maxFailureRate,
      minExecutionRatio: MIN_EXECUTION_RATIO,
      criticalDomains: Array.from(criticalDomains),
    },
  };
}

module.exports = {
  MIN_EXECUTION_RATIO,
  buildDomainSummary,
  summarizeResults,
  evaluateGoNoGo,
};

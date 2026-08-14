'use strict';

const { getBlockingJourneys } = require('../qa/contracts/journeyCriticality');

const MIN_EXECUTION_RATIO = 0.7;

const CHECK_SEVERITY = {
  entityCreated: 'critical',
  linksCreated: 'critical',
  timelineConsistent: 'critical',
  replayGenerated: 'critical',
  evidenceGenerated: 'critical',
  ticketLinked: 'high',
  taskLinked: 'high',
  insightCreated: 'medium',
  actionCreated: 'medium',
  metadataComplete: 'low',
  uiHintsAvailable: 'low',
};

function collectFailedChecksBySeverity(checks = {}) {
  const bySeverity = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    unknown: [],
  };

  for (const [checkName, passed] of Object.entries(checks || {})) {
    if (passed !== false) continue;
    const severity = CHECK_SEVERITY[checkName] || 'unknown';
    bySeverity[severity].push(checkName);
  }

  return bySeverity;
}

function evaluateWaveResult(summary = {}) {
  const checks = summary?.checks || {};
  const bySeverity = collectFailedChecksBySeverity(checks);
  const failedChecks = [
    ...bySeverity.critical,
    ...bySeverity.high,
    ...bySeverity.medium,
    ...bySeverity.low,
    ...bySeverity.unknown,
  ];

  const failureInjection = summary?.failureInjection || null;
  const autocorrection = summary?.autocorrection || null;
  const hasUnhandledFailureInjection = Boolean(
    failureInjection?.enabled === true
      && failureInjection?.type === 'simulated'
      && failureInjection?.handled !== true,
  );

  if (hasUnhandledFailureInjection) {
    return {
      decision: 'NO_GO',
      reason: 'Simulated failure was not handled correctly',
      severity: 'critical',
      failedChecks,
      requiredActions: ['validar_autocorrection', 'revisar_governance_qa_wave'],
    };
  }

  if (autocorrection?.required === true && autocorrection?.created !== true) {
    return {
      decision: 'NO_GO',
      reason: 'Autocorrection required but not created',
      severity: 'critical',
      failedChecks,
      requiredActions: ['executar_autocorrection', 'revisao_humana_obrigatoria'],
    };
  }

  if (bySeverity.critical.length > 0 || summary?.status === 'failed') {
    return {
      decision: 'NO_GO',
      reason: bySeverity.critical.length > 0
        ? 'Critical checks failed'
        : 'Technical execution failed',
      severity: 'critical',
      failedChecks,
      requiredActions: ['abrir_incidente_tecnico', 'executar_autocorrection', 'revisao_humana_obrigatoria'],
    };
  }

  if (bySeverity.high.length > 0) {
    return {
      decision: 'REVIEW',
      reason: 'High severity checks require technical review',
      severity: 'high',
      failedChecks,
      requiredActions: ['revisao_tecnica', 'validar_evidencias_e_replay'],
    };
  }

  if (bySeverity.medium.length > 0 || bySeverity.low.length > 0 || bySeverity.unknown.length > 0) {
    return {
      decision: 'GO_WITH_WARNINGS',
      reason: 'Only medium/low checks failed; operation can continue with warnings',
      severity: 'medium',
      failedChecks,
      requiredActions: ['registrar_warning_operacional', 'acompanhar_wave_no_workspace'],
    };
  }

  if (failureInjection?.enabled === true && failureInjection?.type === 'simulated' && failureInjection?.handled === true) {
    return {
      decision: 'GO',
      reason: 'Simulated failure was handled correctly',
      severity: 'low',
      failedChecks,
      requiredActions: [],
    };
  }

  return {
    decision: 'GO',
    reason: 'All critical checks passed',
    severity: 'low',
    failedChecks,
    requiredActions: [],
  };
}

function buildDomainSummary(results = []) {
  return results.reduce((acc, item) => {
    const domain = item.domain || 'core';
    if (!acc[domain]) {
      acc[domain] = { passed: 0, fallbackPassed: 0, failed: 0, skipped: 0, infra_error: 0, environment_missing: 0, flaky: 0, total: 0 };
    }
    acc[domain].total += 1;
    if (item.status === 'passed') acc[domain].passed += 1;
    else if (item.status === 'passed_via_fallback') {
      acc[domain].fallbackPassed += 1; // rastreia degradação
    } else if (item.status === 'failed') acc[domain].failed += 1;
    else if (item.status === 'infra_error') acc[domain].infra_error += 1;
    else if (item.status === 'environment_missing') acc[domain].environment_missing += 1;
    else if (item.status === 'flaky') acc[domain].flaky += 1;
    else acc[domain].skipped += 1;
    return acc;
  }, {});
}

function summarizeResults(results = [], registryTotal = results.length) {
  const attempted = results.length;
  // passed_via_fallback nunca conta como passed em governanca operacional estrita.
  const passed = results.filter((item) => item.status === 'passed').length;
  const fallbackPassed = results.filter((item) => item.status === 'passed_via_fallback').length;
  const failed = results.filter((item) => item.status === 'failed').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const infraErrors = results.filter((item) => item.status === 'infra_error').length;
  const environmentMissing = results.filter((item) => item.status === 'environment_missing').length;
  const flaky = results.filter((item) => item.status === 'flaky').length;
  const executed = passed + fallbackPassed + failed + infraErrors + environmentMissing + flaky;
  const executionCoverage = registryTotal > 0 ? executed / registryTotal : 0;

  return {
    registryTotal,
    attempted,
    executed,
    passed,
    fallbackPassed,
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
  const strictMode = options.strictMode !== false;
  // Jornadas blocking: default vem do registry declarativo
  // (config/journey-criticality.json); options.blockingJourneys sobrescreve.
  const blockingJourneys = new Set(options.blockingJourneys || getBlockingJourneys());
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

  const fallbackUsed = summary.fallbackPassed > 0;
  const fallbackBlockingUsed = results.filter((item) => (
    item.status === 'passed_via_fallback'
    && (
      item.criticality === 'blocking'
      || blockingJourneys.has(String(item.journeyId || '').trim())
    )
  )).length;

  if (fallbackBlockingUsed > 0) {
    reasons.push('FALLBACK_ON_BLOCKING_SCENARIO');
  }

  if (strictMode && fallbackUsed) {
    reasons.push('FALLBACK_USED_STRICT_MODE');
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
    fallbackPassed: summary.fallbackPassed,
    fallbackBlockingUsed,
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
      strictMode,
      blockingJourneys: Array.from(blockingJourneys),
    },
  };
}

module.exports = {
  MIN_EXECUTION_RATIO,
  CHECK_SEVERITY,
  collectFailedChecksBySeverity,
  evaluateWaveResult,
  buildDomainSummary,
  summarizeResults,
  evaluateGoNoGo,
};

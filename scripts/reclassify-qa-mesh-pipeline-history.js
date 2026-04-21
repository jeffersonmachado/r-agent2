#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { evaluateGoNoGo } = require('../qa-mesh/governance');

const ROOT_DIR = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT_DIR, 'qa-mesh', 'meshHistory');
const PIPELINE_ROOT_CAUSE = 'Cenário exige execução pelo pipeline oficial ou bypass explícito em ambiente local.';
const PIPELINE_SUGGESTION = 'Executar o cenário pelo pipeline oficial ou usar PIPELINE_BYPASS=1 explicitamente em ambiente local.';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function collectDetails(entry) {
  return [
    entry?.errorMessage,
    ...(entry?.errors || []).map((item) => item?.error || item?.message || item),
    ...(entry?.logs || []).map((item) => item?.message || item),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function isPipelinePattern(entry) {
  const details = collectDetails(entry);
  return details.includes('exige o pipeline oficial') || details.includes('execute: npm run pipeline');
}

function shouldReclassifyResult(result) {
  if (!result || !isPipelinePattern(result)) return false;
  return result.failureType !== 'pipeline_required' || result.status !== 'environment_missing';
}

function reclassifyResult(result) {
  return {
    ...result,
    status: 'environment_missing',
    failureType: 'pipeline_required',
    rootCauseHint: PIPELINE_ROOT_CAUSE,
  };
}

function aggregateFailures(results = []) {
  const failures = results.filter((item) => item.status !== 'passed' && item.status !== 'passed_via_fallback');
  const failuresByDomain = {};
  const failuresByType = {};
  const errorCount = new Map();

  failures.forEach((item) => {
    const domain = item.domain || 'core';
    const type = item.failureType || item.status || 'failed';
    if (!failuresByDomain[domain]) {
      failuresByDomain[domain] = {
        total: 0,
        blocking: 0,
        byType: {},
        successRate: 0,
      };
    }
    failuresByDomain[domain].total += 1;
    if (item.criticality === 'blocking') failuresByDomain[domain].blocking += 1;
    failuresByDomain[domain].byType[type] = (failuresByDomain[domain].byType[type] || 0) + 1;
    failuresByType[type] = (failuresByType[type] || 0) + 1;
    if (item.errorMessage) {
      errorCount.set(item.errorMessage, (errorCount.get(item.errorMessage) || 0) + 1);
    }
  });

  const totalsByDomain = results.reduce((acc, item) => {
    acc[item.domain] = acc[item.domain] || { total: 0, passed: 0 };
    acc[item.domain].total += 1;
    if (item.status === 'passed') acc[item.domain].passed += 1;
    return acc;
  }, {});

  Object.entries(totalsByDomain).forEach(([domain, stats]) => {
    if (!failuresByDomain[domain]) {
      failuresByDomain[domain] = {
        total: 0,
        blocking: 0,
        byType: {},
        successRate: stats.total > 0 ? stats.passed / stats.total : 0,
      };
      return;
    }
    failuresByDomain[domain].successRate = stats.total > 0 ? stats.passed / stats.total : 0;
  });

  return {
    failuresByDomain,
    failuresByType,
    topErrors: Array.from(errorCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count })),
    blockingDomains: Object.entries(failuresByDomain)
      .filter(([, value]) => value.blocking > 0)
      .map(([domain]) => domain),
  };
}

function buildRepairPlan(results = []) {
  const criticalityWeight = { blocking: 400, high: 200, medium: 100, low: 50 };
  const failureTypeWeight = {
    infra_error: 500,
    environment_missing: 350,
    pipeline_required: 350,
    auth_redirect: 320,
    permission_block: 320,
    loading_stuck: 300,
    maintenance_not_rendered: 280,
    hidden_element: 260,
    functional_failure: 250,
    flaky: 150,
  };
  const domainWeight = { core: 220, pbx: 220, omnichannel: 200, fitness: 120, beauty: 120, bpmn: 100 };

  const orderedFixList = results
    .filter((item) => item.status !== 'passed')
    .map((item) => ({
      scenarioId: item.id,
      domain: item.domain,
      status: item.status,
      failureType: item.failureType,
      priority:
        (criticalityWeight[item.criticality] || 0) +
        (failureTypeWeight[item.failureType] || 0) +
        (domainWeight[item.domain] || 0),
      criticality: item.criticality,
      rootCauseHint: item.rootCauseHint,
      errorMessage: item.errorMessage,
    }))
    .sort((a, b) => b.priority - a.priority);

  return {
    generatedAt: new Date().toISOString(),
    orderedFixList,
  };
}

function reclassifyClusters(clusters = []) {
  return clusters.map((cluster) => {
    const sampleError = String(cluster?.sampleError || '');
    if (!isPipelinePattern({ errorMessage: sampleError })) return cluster;
    return {
      ...cluster,
      failureType: 'pipeline_required',
      fingerprint: `${cluster.domain || 'core'}::pipeline_required::${sampleError}`,
      suggestion: PIPELINE_SUGGESTION,
    };
  });
}

function processFile(filePath, shouldWrite) {
  const payload = readJson(filePath);
  const originalResults = Array.isArray(payload.results) ? payload.results : [];
  let changed = 0;
  const results = originalResults.map((result) => {
    if (!shouldReclassifyResult(result)) return result;
    changed += 1;
    return reclassifyResult(result);
  });

  if (changed === 0) {
    return { filePath, changed: 0 };
  }

  payload.results = results;

  const thresholds = payload.governance?.thresholds || {};
  const registryTotal = payload.summary?.registryTotal || payload.governance?.registryTotal || results.length;
  const governance = evaluateGoNoGo(results, {
    registryTotal,
    maxFailureRate: Number.isFinite(thresholds.maxFailureRate) ? thresholds.maxFailureRate : undefined,
    criticalDomains: Array.isArray(thresholds.criticalDomains) ? thresholds.criticalDomains : undefined,
  });
  const failureAnalysis = aggregateFailures(results);

  payload.governance = {
    ...payload.governance,
    ...governance,
  };

  payload.summary = {
    ...payload.summary,
    registryTotal,
    attempted: governance.attempted,
    executed: governance.executed,
    passed: governance.passed,
    fallbackPassed: governance.fallbackPassed,
    failed: governance.failed,
    skipped: governance.skipped,
    infraErrors: governance.infraErrors,
    environmentMissing: governance.environmentMissing,
    flaky: governance.flaky,
    executionCoverage: governance.executionCoverage,
    executionQuality: governance.executionQuality,
    domains: governance.domains,
    goNoGo: governance.goNoGo,
    reasons: governance.reasons,
    pipelineBlocked: failureAnalysis.failuresByType.pipeline_required || 0,
    failuresByDomain: failureAnalysis.failuresByDomain,
    failuresByType: failureAnalysis.failuresByType,
    topErrors: failureAnalysis.topErrors,
    blockingDomains: failureAnalysis.blockingDomains,
  };

  payload.repairPlan = buildRepairPlan(results);

  if (payload.intelligence?.clusters) {
    payload.intelligence = {
      ...payload.intelligence,
      clusters: reclassifyClusters(payload.intelligence.clusters),
    };
  }

  if (shouldWrite) {
    writeJson(filePath, payload);
  }

  return { filePath, changed };
}

function main() {
  const shouldWrite = process.argv.includes('--write');
  const files = fs.readdirSync(HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(HISTORY_DIR, file));

  let filesChanged = 0;
  let resultsChanged = 0;

  for (const filePath of files) {
    const report = processFile(filePath, shouldWrite);
    if (report.changed > 0) {
      filesChanged += 1;
      resultsChanged += report.changed;
      console.log(`${shouldWrite ? 'updated' : 'would-update'} ${path.basename(filePath)} results=${report.changed}`);
    }
  }

  console.log(`files_changed=${filesChanged}`);
  console.log(`results_changed=${resultsChanged}`);
  console.log(`mode=${shouldWrite ? 'write' : 'dry-run'}`);
}

main();
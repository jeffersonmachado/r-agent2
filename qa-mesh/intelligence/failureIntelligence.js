'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function compact(value) {
  return String(value || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintFor(result) {
  return [
    result.domain || 'core',
    result.failureType || result.status || 'passed',
    compact(result.errorMessage || result.rootCauseHint || 'ok').slice(0, 160),
  ].join('::');
}

function buildSuggestion(result) {
  const failureType = String(result.failureType || result.status || '').toLowerCase();
  if (failureType.includes('auth')) return 'Revalidar bootstrap de sessão, token RPA e isolamento de tenant.';
  if (failureType.includes('infra')) return 'Priorizar correção de browser/runtime/rede antes de investigar regra de negócio.';
  if (failureType.includes('loading')) return 'Inspecionar readiness da tela e remover dependências implícitas de timing.';
  if (failureType.includes('permission')) return 'Revisar RBAC/ACL do tenant e pré-condições do cenário.';
  if (failureType.includes('flaky')) return 'Transformar waits implícitos em sincronização semântica e revisar estado compartilhado.';
  return 'Inspecionar o artefato do cenário e corrigir a causa raiz antes de reexecutar a wave.';
}

function buildFailureIntelligence(currentExecution, history = [], options = {}) {
  const results = Array.isArray(currentExecution?.results) ? currentExecution.results : [];
  const failures = results.filter((item) => item.status !== 'passed');
  const fingerprints = new Map();
  const recurring = new Map();
  const stability = new Map();

  for (const execution of [...history, currentExecution]) {
    for (const item of execution?.results || []) {
      const domain = item.domain || 'core';
      const stats = stability.get(domain) || { passed: 0, total: 0 };
      stats.total += 1;
      if (item.status === 'passed') stats.passed += 1;
      stability.set(domain, stats);

      if (item.status === 'passed') continue;
      const fingerprint = fingerprintFor(item);
      recurring.set(fingerprint, (recurring.get(fingerprint) || 0) + 1);
    }
  }

  for (const item of failures) {
    const fingerprint = fingerprintFor(item);
    const cluster = fingerprints.get(fingerprint) || {
      fingerprint,
      domain: item.domain || 'core',
      failureType: item.failureType || item.status || 'failed',
      count: 0,
      scenarios: [],
      sampleError: item.errorMessage || item.rootCauseHint || null,
      recurringCount: recurring.get(fingerprint) || 0,
      suggestion: buildSuggestion(item),
    };
    cluster.count += 1;
    cluster.scenarios.push(item.id);
    fingerprints.set(fingerprint, cluster);
  }

  const clusters = Array.from(fingerprints.values()).sort((left, right) => {
    const leftWeight = (left.recurringCount * 10) + left.count;
    const rightWeight = (right.recurringCount * 10) + right.count;
    return rightWeight - leftWeight;
  });

  const rankedProblems = clusters.map((item) => ({
    ...item,
    impactScore: (item.recurringCount * 100) + (item.count * 10),
  })).sort((left, right) => right.impactScore - left.impactScore);

  const moduleStability = Array.from(stability.entries()).map(([domain, stats]) => ({
    domain,
    stabilityScore: stats.total > 0 ? Number((stats.passed / stats.total).toFixed(4)) : 0,
    passed: stats.passed,
    total: stats.total,
  })).sort((left, right) => left.stabilityScore - right.stabilityScore);

  const intelligence = {
    generatedAt: new Date().toISOString(),
    executionId: currentExecution?.executionId || null,
    // RUNTIME_EVIDENCE (config/runtime-evidence-artifacts.json): lineage NA
    // ORIGEM — sem runId/sourceFingerprint o gate validate:qa-evidence-same-run
    // reprova com QA_EVIDENCE_LINEAGE_MISSING (medido na fase consolidate do
    // release r-agent2-20260920-141717). Fora de run governado: null explícito.
    runId: currentExecution?.runId || null,
    sourceFingerprint: currentExecution?.sourceFingerprint || null,
    sourceCommit: currentExecution?.sourceCommit || null,
    sourceTree: currentExecution?.sourceTree || null,
    artifactType: 'mesh-intelligence',
    artifactVersion: '1.0.0',
    totalClusters: clusters.length,
    clusters,
    rankedProblems,
    recurringFailures: rankedProblems.filter((item) => item.recurringCount > 1),
    moduleStability,
  };

  if (options.outputDir) {
    ensureDir(options.outputDir);
    const target = path.join(options.outputDir, 'latest.json');
    fs.writeFileSync(target, `${JSON.stringify(intelligence, null, 2)}\n`, 'utf8');
    intelligence.outputPath = target;
  }

  return intelligence;
}

module.exports = {
  buildFailureIntelligence,
};
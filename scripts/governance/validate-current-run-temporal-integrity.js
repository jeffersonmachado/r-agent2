#!/usr/bin/env node
'use strict';

/**
 * validate-current-run-temporal-integrity.js — gate CURRENT_RUN_TEMPORAL_INTEGRITY.
 *
 * DEFEITO QUE ORIGINOU ESTE GATE (medido 2026-10-05, release r-agent2-20261005-011259):
 * `governance/mutable-json-state-validation-report.json` e
 * `governance/json-persistence-audit.json` foram produzidos às 01:20 e o run só
 * começou às 02:30 — mas os dois estavam dentro do payload carregando o
 * runId/sourceFingerprint do run. Nenhuma outra checagem pegava isso (runId certo,
 * fingerprint certo, artifactType presente): só o TEMPO prova que nada rodou nele.
 *
 * O gate varre TODOS os artefatos com autoridade no run:
 *   (a) os classificados como autoritativos na taxonomia
 *       (config/runtime-evidence-artifacts.json), e
 *   (b) os consumidos pelo Master Scorecard (governance/master-scorecard-registry.js)
 *       — que precisam ESTAR classificados: artefato usado em decisão sem
 *       classificação é NO_GO, nunca "estampável por desconhecido".
 *
 * PASS exige: preRunAuthoritativeArtifacts = 0, wrongRun = 0, invalid = 0,
 * unknownClassification = 0 e nenhuma dimensão consumindo artefato
 * histórico/transicional.
 */

const fs = require('fs');
const path = require('path');

const {
  STATUS,
  classifyArtifact,
  isAuthoritativeArtifact,
  listAuthoritativeArtifacts,
  listNonAuthoritativeArtifacts,
  getProducer,
  evaluateTemporalIntegrity,
  loadConfig: loadAuthorityConfig,
} = require('./lib/runtime-evidence-artifacts');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');
const REPORT_RELATIVE = 'reports/current-run-temporal-integrity-report.json';

function resolveRoot() {
  return process.env.TEMPORAL_INTEGRITY_ROOT
    ? path.resolve(process.env.TEMPORAL_INTEGRITY_ROOT)
    : DEFAULT_ROOT;
}

/**
 * Run corrente. A fonte é o ponteiro do workspace (`governance/.current-run.json`),
 * o MESMO consumido pelo drift-guard da selagem. Ausente/incompleto = fail-closed.
 */
function resolveRun(root) {
  const file = path.join(root, 'governance', '.current-run.json');
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
  if (!parsed || !parsed.runId || !parsed.startedAt) return null;
  return {
    run_id: parsed.runId,
    source_fingerprint: parsed.sourceFingerprint || null,
    started_at: parsed.startedAt,
  };
}

/** Caminhos distintos de artefato declarados pelo Master Scorecard. */
function scorecardDeclaredPaths(root) {
  const registryPath = path.join(root, 'governance', 'master-scorecard-registry.js');
  if (!fs.existsSync(registryPath)) return [];
  const { MASTER_SCORECARD_REGISTRY } = require(registryPath);
  const found = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object') return;
    if (typeof node.path === 'string' && node.path.trim()) found.add(node.path.trim());
    for (const value of Object.values(node)) walk(value);
  };
  walk(MASTER_SCORECARD_REGISTRY);
  return [...found].sort();
}

function readArtifact(root, relativePath) {
  const abs = path.join(root, relativePath);
  if (!fs.existsSync(abs)) return { exists: false, value: null };
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch (_) {
    return { exists: true, value: undefined, parseError: true };
  }
}

/**
 * Expande os globs de artefatos NÃO autoritativos (ex.: dist/archive/**) para
 * que o gate possa CONTAR e PROVAR que ficaram fora da decisão. Limitado de
 * propósito: é auditoria, não varredura de disco.
 */
function expandNonAuthoritativeGlobs(root, maxFiles = 25) {
  const found = [];
  const config = loadAuthorityConfig();
  for (const entry of config.globs || []) {
    const prefix = String(entry.glob || '').replace(/\/\*\*$/, '');
    if (!prefix) continue;
    const base = path.join(root, prefix);
    if (!fs.existsSync(base)) continue;
    const walk = (dir, depth) => {
      if (depth > 4 || found.length >= maxFiles) return;
      let items;
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const item of items) {
        if (found.length >= maxFiles) return;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) walk(abs, depth + 1);
        else if (item.name.endsWith('.json')) found.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    };
    walk(base, 0);
  }
  return found;
}

function evaluateRunTemporalIntegrity({ root = resolveRoot(), run = null, nowMs = Date.now(), declaredPaths = null } = {}) {
  const effectiveRun = run || resolveRun(root);
  const declared = Array.isArray(declaredPaths) ? [...declaredPaths] : scorecardDeclaredPaths(root);
  const authoritative = listAuthoritativeArtifacts();
  const nonAuthoritative = listNonAuthoritativeArtifacts();
  const archiveFiles = expandNonAuthoritativeGlobs(root);
  const targets = [...new Set([...declared, ...authoritative, ...nonAuthoritative, ...archiveFiles])].sort();

  const totals = {
    totalAuthoritativeArtifacts: 0,
    sameRunArtifacts: 0,
    preRunArtifacts: 0,
    wrongRunArtifacts: 0,
    unknownClassification: 0,
    historicalIgnored: 0,
    transitionalIgnored: 0,
    invalidArtifacts: 0,
    missingArtifacts: 0,
  };
  const violations = [];
  const entries = [];

  if (!effectiveRun) {
    return {
      status: 'FAIL',
      run: null,
      totals,
      violations: [{ code: 'CURRENT_RUN_UNRESOLVED', detail: 'governance/.current-run.json ausente ou sem runId/startedAt — sem run não há integridade temporal a provar' }],
      entries,
    };
  }

  const scorecardSet = new Set(declared);

  for (const relativePath of targets) {
    const classification = classifyArtifact(relativePath);
    const authoritativeFlag = isAuthoritativeArtifact(relativePath);
    const consumedByScorecard = scorecardSet.has(relativePath);
    const { exists, value, parseError } = readArtifact(root, relativePath);
    const evaluation = evaluateTemporalIntegrity({
      artifactPath: relativePath,
      artifact: parseError ? undefined : value,
      run: effectiveRun,
      nowMs,
    });

    const entry = {
      path: relativePath,
      classification,
      consumedByScorecard,
      status: evaluation.status,
      code: evaluation.code,
      reasons: evaluation.reasons,
      generatedAt: value && typeof value === 'object' ? (value.generatedAt || null) : null,
      producer: getProducer(relativePath),
    };
    entries.push(entry);

    if (!exists) {
      totals.missingArtifacts += 1;
      continue;
    }

    if (evaluation.status === STATUS.HISTORICAL) {
      totals.historicalIgnored += 1;
      if (consumedByScorecard) {
        violations.push({ code: 'SCORECARD_CONSUMES_NON_AUTHORITATIVE_ARTIFACT', path: relativePath, classification, detail: 'artefato histórico não pode sustentar dimensão do scorecard' });
      }
      continue;
    }
    if (evaluation.status === STATUS.TRANSITIONAL) {
      totals.transitionalIgnored += 1;
      if (consumedByScorecard) {
        violations.push({ code: 'SCORECARD_CONSUMES_NON_AUTHORITATIVE_ARTIFACT', path: relativePath, classification, detail: 'artefato transicional não pode sustentar dimensão do scorecard' });
      }
      continue;
    }
    if (!classification) {
      totals.unknownClassification += 1;
      if (consumedByScorecard) {
        violations.push({ code: 'UNCLASSIFIED_AUTHORITATIVE_ARTIFACT', path: relativePath, detail: 'artefato usado em decisão sem classificação na taxonomia (fail-closed)' });
      }
      continue;
    }
    if (!authoritativeFlag) continue;

    totals.totalAuthoritativeArtifacts += 1;
    if (evaluation.status === STATUS.SAME_RUN) totals.sameRunArtifacts += 1;
    if (evaluation.status === STATUS.STALE_ARTIFACT && evaluation.code === 'stale_artifact_pre_run') {
      totals.preRunArtifacts += 1;
      violations.push({ code: 'PRE_RUN_AUTHORITATIVE_ARTIFACT', path: relativePath, classification, generatedAt: entry.generatedAt, runStartedAt: effectiveRun.started_at, producer: entry.producer, detail: 'artefato autoritativo produzido ANTES do início do run: reexecute o produtor (não estampe)' });
      continue;
    }
    if (evaluation.status === STATUS.WRONG_RUN) {
      totals.wrongRunArtifacts += 1;
      violations.push({ code: 'WRONG_RUN_AUTHORITATIVE_ARTIFACT', path: relativePath, classification, detail: 'artefato autoritativo com runId de outro run' });
      continue;
    }
    if (evaluation.status !== STATUS.SAME_RUN) {
      totals.invalidArtifacts += 1;
      violations.push({ code: 'INVALID_AUTHORITATIVE_ARTIFACT', path: relativePath, classification, reasons: evaluation.reasons, detail: 'artefato autoritativo sem lineage temporal válido' });
    }
  }

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    run: effectiveRun,
    totals,
    violations,
    entries,
  };
}

function writeReport(root, payload) {
  const out = path.join(root, REPORT_RELATIVE);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  return out;
}

function main() {
  const root = resolveRoot();
  const evaluation = evaluateRunTemporalIntegrity({ root });
  const payload = {
    artifactType: 'current-run-temporal-integrity-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    status: evaluation.status,
    runId: evaluation.run ? evaluation.run.run_id : null,
    sourceFingerprint: evaluation.run ? evaluation.run.source_fingerprint : null,
    runStartedAt: evaluation.run ? evaluation.run.started_at : null,
    totals: evaluation.totals,
    violationCount: evaluation.violations.length,
    violations: evaluation.violations,
    entries: evaluation.entries,
  };
  const out = writeReport(root, payload);

  console.log(`[temporal-integrity] status=${payload.status} run=${payload.runId || 'n/d'} preRun=${evaluation.totals.preRunArtifacts} sameRun=${evaluation.totals.sameRunArtifacts} autoritativos=${evaluation.totals.totalAuthoritativeArtifacts} violações=${evaluation.violations.length}`);
  for (const violation of evaluation.violations.slice(0, 20)) {
    const where = violation.path ? ` ${violation.path}` : '';
    console.log(`  - ${violation.code}${where}${violation.generatedAt ? ` (generatedAt=${violation.generatedAt} < runStartedAt=${violation.runStartedAt})` : ''}`);
  }
  console.log(`[temporal-integrity] report=${out}`);

  if (payload.status !== 'PASS') process.exitCode = 1;
}

module.exports = {
  evaluateRunTemporalIntegrity,
  resolveRun,
  scorecardDeclaredPaths,
  REPORT_RELATIVE,
};

if (require.main === module) {
  main();
}

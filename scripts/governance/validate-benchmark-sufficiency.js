#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-sufficiency.js — gate de SUFICIÊNCIA DA AMOSTRA DE BENCHMARKS.
 *
 * Responde, por vertical: "o conjunto de benchmarks escolhido representa
 * suficientemente o mercado para permitir considerar o inventário materialmente
 * completo?".
 *
 * O que este gate FALHA (exit 1) — ou seja, o que é proibido:
 *  - amostra malformada / versão ausente;
 *  - uma vertical DECLARAR suficiência (`claim: SAMPLE_SUFFICIENT`) sem que o
 *    engine confirme;
 *  - uma vertical reivindicar cobertura de mercado (percentual) sem suficiência;
 *  - usar o mesmo holdout duas vezes / holdout sem pré-registro;
 *  - qualquer violação de anti-gaming detectada pelo engine OU inconsistência
 *    entre o que a vertical declara e o que a evidência mostra.
 *
 * O que este gate NÃO falha: uma vertical cuja amostra ainda NÃO é suficiente.
 * Ausência de prova não é fraude — é estado `SAMPLE_NOT_SATURATED`, reportado
 * honestamente. O gate existe para impedir a MENTIRA, não para inventar mercado.
 *
 * Saída: `reports/benchmark-sufficiency-report.json` (versionado).
 *
 * Uso: node scripts/governance/validate-benchmark-sufficiency.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  evaluateSampleSufficiency, SAMPLE_STATES,
} = require('../../qa/benchmarks/benchmarkSufficiencyEngine');

const ROOT_DIR = path.join(__dirname, '..', '..');
const POLICY_PATH = path.join(ROOT_DIR, 'config', 'benchmark-sufficiency-policy.json');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');
const COVERAGE_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'coverage-completeness-report.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-sufficiency-report.json');

const VIOLATION_CODES = Object.freeze({
  POLICY_MISSING: 'benchmark_policy_missing',
  SAMPLE_MALFORMED: 'benchmark_sample_malformed',
  SAMPLE_VERSION_MISSING: 'benchmark_sample_version_missing',
  SUFFICIENCY_CLAIM_UNPROVEN: 'sample_sufficiency_claim_unproven',
  MARKET_COVERAGE_CLAIM_WITHOUT_SUFFICIENCY: 'market_coverage_claim_without_sufficiency',
  HOLDOUT_NOT_PREREGISTERED: 'holdout_not_preregistered',
  HOLDOUT_LEAKAGE: 'holdout_leakage',
  CRITICAL_GATE_FAILED_WITH_SUFFICIENT_CLAIM: 'critical_gate_failed_with_sufficient_claim',
  VERTICAL_NOT_REGISTERED: 'benchmark_sample_vertical_not_registered',
});

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function loadPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return null;
  return readJson(POLICY_PATH);
}

function loadSamples() {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs.readdirSync(SAMPLES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ file: path.relative(ROOT_DIR, path.join(SAMPLES_DIR, name)), absPath: path.join(SAMPLES_DIR, name) }));
}

/** Verticais registradas em config/verticals.json (kind === 'vertical'). */
function loadRegisteredVerticals() {
  const registryPath = path.join(ROOT_DIR, 'config', 'verticals.json');
  if (!fs.existsSync(registryPath)) return [];
  const registry = readJson(registryPath);
  return Object.entries(registry.domains || {})
    .filter(([, def]) => String(def.kind) === 'vertical')
    .map(([id]) => id);
}

function loadCoverageReport() {
  if (!fs.existsSync(COVERAGE_REPORT_PATH)) return null;
  try {
    return readJson(COVERAGE_REPORT_PATH);
  } catch (_) {
    return null;
  }
}

/** Extrai { verticalId → percentual declarado } do relatório de cobertura. */
function coverageByVertical(report) {
  const map = new Map();
  if (!report) return map;
  const source = report.verticals || report.coverage || report.domains || {};
  const entries = Array.isArray(source) ? source : Object.values(source);
  for (const entry of entries) {
    if (!entry || !entry.domain) continue;
    const pct = Number(entry.percentage ?? entry.coverage ?? entry.capabilityCoverage);
    if (Number.isFinite(pct)) map.set(String(entry.domain), pct);
  }
  return map;
}

function run({ policy, samples, registeredVerticals, coverage }) {
  const violations = [];
  const verticals = [];

  for (const { file, absPath } of samples) {
    let sample;
    try {
      sample = readJson(absPath);
    } catch (error) {
      violations.push({ code: VIOLATION_CODES.SAMPLE_MALFORMED, file, detail: error.message });
      continue;
    }
    if (!sample.sampleVersion || !sample.vertical) {
      violations.push({ code: VIOLATION_CODES.SAMPLE_VERSION_MISSING, file, vertical: sample.vertical || null });
    }
    if (registeredVerticals.length > 0 && !registeredVerticals.includes(sample.vertical)) {
      violations.push({ code: VIOLATION_CODES.VERTICAL_NOT_REGISTERED, file, vertical: sample.vertical });
    }

    const evaluation = evaluateSampleSufficiency({ sample, policy });

    // Declaração de suficiência só vale com prova.
    if (sample.sampleSufficiencyClaim === SAMPLE_STATES.SUFFICIENT && evaluation.status !== SAMPLE_STATES.SUFFICIENT) {
      violations.push({
        code: VIOLATION_CODES.SUFFICIENCY_CLAIM_UNPROVEN,
        vertical: sample.vertical,
        declared: sample.sampleSufficiencyClaim,
        actual: evaluation.status,
        blockingGates: evaluation.criticalBlocking.map((b) => b.gate),
      });
    }

    // Cobertura de mercado (percentual) exige suficiência provada.
    const declaredCoverage = coverage.get(sample.vertical);
    if (Number.isFinite(declaredCoverage) && declaredCoverage >= 100 && evaluation.status !== SAMPLE_STATES.SUFFICIENT) {
      violations.push({
        code: VIOLATION_CODES.MARKET_COVERAGE_CLAIM_WITHOUT_SUFFICIENCY,
        vertical: sample.vertical,
        declaredCoverage,
        actual: evaluation.status,
      });
    }

    // Holdout: pré-registro obrigatório; leakage é fraude metodológica.
    if (evaluation.gates.holdoutValidation.status === 'FAIL') {
      const reasons = (evaluation.gates.holdoutValidation.violations || []).map((v) => v.reason);
      if (reasons.includes('holdout_not_preregistered')) {
        violations.push({ code: VIOLATION_CODES.HOLDOUT_NOT_PREREGISTERED, vertical: sample.vertical });
      }
      if (reasons.some((r) => String(r).startsWith('holdout_leakage'))) {
        violations.push({ code: VIOLATION_CODES.HOLDOUT_LEAKAGE, vertical: sample.vertical });
      }
    }

    verticals.push({
      vertical: sample.vertical,
      sampleVersion: sample.sampleVersion,
      inventoryVersion: sample.inventoryVersion || null,
      file,
      status: evaluation.status,
      certifiable: evaluation.certifiable,
      declaredClaim: sample.sampleSufficiencyClaim || null,
      externalBlock: evaluation.externalBlock || null,
      coverageDeclaredPercent: Number.isFinite(declaredCoverage) ? declaredCoverage : null,
      marketCoverageCertifiable: evaluation.certifiable,
      discoverySet: evaluation.discoverySet,
      validationSet: evaluation.validationSet,
      archetypeCoverage: evaluation.gates.marketArchetypeCoverage,
      diversity: evaluation.gates.benchmarkDiversity,
      saturation: {
        capability: evaluation.gates.capabilitySaturation.status,
        journey: evaluation.gates.journeySaturation.status,
        businessRule: evaluation.gates.businessRuleSaturation.status,
        window: evaluation.gates.capabilitySaturation.window || [],
      },
      holdout: evaluation.gates.holdoutValidation,
      sourceQuality: evaluation.gates.sourceQuality.status,
      freshness: evaluation.gates.freshness.status,
      orderSensitivity: evaluation.gates.orderSensitivity.orderSensitivity,
      criticalBlocking: evaluation.criticalBlocking,
      discoveryCurve: evaluation.discoveryCurve,
      inventorySize: evaluation.inventorySize,
      leaveOneOutConcentration: evaluation.leaveOneOut.concentration,
    });
  }

  // Toda vertical registrada aparece no relatório. Ausência de amostra é um
  // ESTADO (SAMPLE_NOT_RESEARCHED), nunca um silêncio: §50 exige responder
  // "100% de qual universo?" antes de qualquer percentual.
  for (const verticalId of registeredVerticals) {
    if (verticals.some((v) => v.vertical === verticalId)) continue;
    verticals.push({
      vertical: verticalId,
      sampleVersion: null,
      inventoryVersion: null,
      file: null,
      sampleFilePresent: false,
      status: 'SAMPLE_NOT_RESEARCHED',
      certifiable: false,
      declaredClaim: null,
      externalBlock: null,
      coverageDeclaredPercent: Number.isFinite(coverage.get(verticalId)) ? coverage.get(verticalId) : null,
      marketCoverageCertifiable: false,
      discoverySet: [],
      validationSet: [],
      criticalBlocking: [{ gate: 'analysisEvidence', reason: 'sample_file_absent' }],
    });
  }
  verticals.sort((a, b) => String(a.vertical).localeCompare(String(b.vertical)));

  return { violations, verticals };
}

function main() {
  const policy = loadPolicy();
  const violations = [];
  let result = { violations: [], verticals: [] };

  if (!policy) {
    violations.push({ code: VIOLATION_CODES.POLICY_MISSING, path: path.relative(ROOT_DIR, POLICY_PATH) });
  } else {
    result = run({
      policy,
      samples: loadSamples(),
      registeredVerticals: loadRegisteredVerticals(),
      coverage: coverageByVertical(loadCoverageReport()),
    });
  }

  const all = [...violations, ...result.violations];
  const report = {
    reportType: 'benchmark-sufficiency',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: all.length === 0 ? 'PASS' : 'FAIL',
    policyVersion: policy ? policy.version : null,
    policyPath: path.relative(ROOT_DIR, POLICY_PATH),
    stateTaxonomy: Object.values(SAMPLE_STATES),
    verticalsAnalysed: result.verticals.length,
    sufficientVerticals: result.verticals.filter((v) => v.status === SAMPLE_STATES.SUFFICIENT).map((v) => v.vertical),
    violations: all,
    verticals: result.verticals,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[benchmark-sufficiency] status=${report.status} policy=v${report.policyVersion} `
      + `verticais=${report.verticalsAnalysed} suficientes=${report.sufficientVerticals.length} violações=${all.length}\n`,
    );
    for (const v of report.verticals) {
      process.stdout.write(`  - ${v.vertical} (${v.sampleVersion}): ${v.status}${v.externalBlock ? ` [${v.externalBlock.code}]` : ''}\n`);
    }
    for (const v of all) process.stdout.write(`  ! ${v.code}: ${JSON.stringify(v)}\n`);
  }
  process.exit(all.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { run, main, VIOLATION_CODES, coverageByVertical, REPORT_PATH, POLICY_PATH, SAMPLES_DIR };

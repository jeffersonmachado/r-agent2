#!/usr/bin/env node
'use strict';

/**
 * validate-benchmark-certification-consistency.js — gate
 * BENCHMARK_CERTIFICATION_CONSISTENCY.
 *
 * PERGUNTA: todos os gates de benchmark estão falando da MESMA certificação —
 * e essa certificação tem auditoria real por trás?
 *
 * O PASS vacuoso medido em 2026-09-19 tinha duas formas, e este gate fecha as
 * duas:
 *
 *  1. DIVERGÊNCIA silenciosa: o engine derivava MARKET_SAMPLE_CERTIFIED para
 *     fitness enquanto semantic-version e persisted-corpus auditavam ZERO
 *     verticais (liam `sample.claim`, que nenhum produtor grava). Cada gate
 *     tinha sua própria definição de "certificada".
 *  2. VACUIDADE silenciosa: PASS com certifiedSamples=0 e
 *     persistedFindingsChecked=0 — "certificado" sem um único achado auditado.
 *
 * CHECKS
 *   BENCHMARK_CERTIFICATION_CROSS_CONSISTENCY
 *     o conjunto de verticais certificadas pela autoridade única
 *     (relatório canônico do engine de suficiência) == conjunto auditado como
 *     certificado pelo semantic-version == conjunto do persisted-corpus == e
 *     o phase model é coerente (vertical certificada tem fase >=
 *     SAMPLE_SUFFICIENT; fase >= SAMPLE_SUFFICIENT só existe com a autoridade
 *     certificando).
 *   BENCHMARK_CERTIFICATION_NON_VACUOUS
 *     certifiedVerticals>0 exige auditoria real: o conjunto de verticais
 *     efetivamente auditadas pelo semantic-version é igual ao certificado E
 *     persistedFindingsChecked>0.
 *
 * FAIL-CLOSED nos insumos: qualquer relatório ausente, malformado ou stale é
 * violação explícita — este gate nunca infere nada por conta própria.
 *
 * Uso: node scripts/governance/validate-benchmark-certification-consistency.js
 */

const fs = require('fs');
const path = require('path');

const { PHASES, phaseIndex } = require('../../api/services/benchmark/benchmarkPhaseModel');
const { loadCertificationAuthority } = require('./lib/benchmarkCertificationAuthority');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-certification-consistency-report.json');

const SEMANTIC_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-semantic-version-report.json');
const CORPUS_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-persisted-corpus-report.json');
const PHASE_MODEL_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-phase-model-report.json');

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const CODES = Object.freeze({
  CROSS_CONSISTENCY: 'BENCHMARK_CERTIFICATION_CROSS_CONSISTENCY',
  NON_VACUOUS: 'BENCHMARK_CERTIFICATION_NON_VACUOUS',
  INPUT_UNAVAILABLE: 'BENCHMARK_CERTIFICATION_INPUT_UNAVAILABLE',
});

function sortedSet(values) {
  return [...new Set((values || []).map(String))].sort();
}

function setKey(values) {
  return JSON.stringify(sortedSet(values));
}

/**
 * Comparação PURA dos conjuntos publicados (testável sem disco).
 *
 * @param {object} input
 * @param {string[]} input.certifiedVerticals   conjunto da autoridade única
 * @param {object} input.semanticReport         benchmark-semantic-version-report
 * @param {object} input.corpusReport           benchmark-persisted-corpus-report
 * @param {object} input.phaseModelReport       benchmark-phase-model-report
 * @returns {Array<{code, source?, vertical?, detail}>}
 */
function evaluateConsistency({ certifiedVerticals, semanticReport, corpusReport, phaseModelReport }) {
  const violations = [];
  const certified = sortedSet(certifiedVerticals);
  const certifiedKey = setKey(certified);

  const semanticCertified = sortedSet(semanticReport.certifiedVerticals);
  if (setKey(semanticCertified) !== certifiedKey) {
    violations.push({
      code: CODES.CROSS_CONSISTENCY,
      source: 'reports/benchmark-semantic-version-report.json',
      detail: `semantic-version auditou como certificadas [${semanticCertified.join(', ')}] `
        + `mas a autoridade certifica [${certified.join(', ')}]`,
    });
  }

  const corpusCertified = sortedSet(corpusReport.certifiedVerticals);
  if (setKey(corpusCertified) !== certifiedKey) {
    violations.push({
      code: CODES.CROSS_CONSISTENCY,
      source: 'reports/benchmark-persisted-corpus-report.json',
      detail: `persisted-corpus auditou como certificadas [${corpusCertified.join(', ')}] `
        + `mas a autoridade certifica [${certified.join(', ')}]`,
    });
  }

  const phaseEntries = Array.isArray(phaseModelReport.verticals) ? phaseModelReport.verticals : [];
  const sufficientIndex = phaseIndex(PHASES.SAMPLE_SUFFICIENT);
  for (const entry of phaseEntries) {
    const aboveSufficient = phaseIndex(entry.phase) >= sufficientIndex;
    if (aboveSufficient && !certified.includes(String(entry.vertical))) {
      violations.push({
        code: CODES.CROSS_CONSISTENCY,
        source: 'reports/benchmark-phase-model-report.json',
        vertical: entry.vertical,
        detail: `phase model reporta ${entry.phase} sem a autoridade certificar a vertical — certificação por omissão`,
      });
    }
  }
  for (const vertical of certified) {
    const entry = phaseEntries.find((e) => String(e.vertical) === vertical);
    if (!entry || phaseIndex(entry.phase) < sufficientIndex) {
      violations.push({
        code: CODES.CROSS_CONSISTENCY,
        source: 'reports/benchmark-phase-model-report.json',
        vertical,
        detail: `autoridade certifica a vertical mas o phase model reporta fase ${entry ? entry.phase : '(ausente)'} — abaixo de ${PHASES.SAMPLE_SUFFICIENT}`,
      });
    }
  }

  if (certified.length > 0) {
    const audited = sortedSet(semanticReport.auditedCertifiedVerticals);
    const checked = Number(semanticReport.persistedFindingsChecked) || 0;
    if (setKey(audited) !== certifiedKey || checked === 0) {
      violations.push({
        code: CODES.NON_VACUOUS,
        source: 'reports/benchmark-semantic-version-report.json',
        detail: `certifiedVerticals=${certified.length} auditedCertifiedVerticals=[${audited.join(', ')}] `
          + `persistedFindingsChecked=${checked} — certificação sem auditoria real de achados é o PASS vacuoso que este gate proíbe`,
      });
    }
  }

  return violations;
}

/** Carrega um relatório-insumo com fail-closed (ausente/malformado/stale = erro). */
function loadInputReport(reportPath, { now, maxAgeMs }) {
  const relative = path.relative(ROOT_DIR, reportPath);
  if (!fs.existsSync(reportPath)) {
    return { report: null, error: `${relative} ausente — rode o gate produtor antes deste` };
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return { report: null, error: `${relative} inválido: ${error.message}` };
  }
  const generatedAtMs = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return { report: null, error: `${relative} sem generatedAt válido — frescor não se assume` };
  }
  if (now - generatedAtMs > maxAgeMs) {
    return { report: null, error: `${relative} STALE (generatedAt=${report.generatedAt}) — rode o gate produtor para renovar` };
  }
  return { report, error: null };
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const now = Date.now();
  const maxAgeMs = Number(process.env.BENCHMARK_CERTIFICATION_REPORT_MAX_AGE_MS) || DEFAULT_MAX_AGE_MS;
  const violations = [];

  let authority = null;
  try {
    authority = loadCertificationAuthority({ now, maxAgeMs });
  } catch (error) {
    violations.push({ code: error.code || CODES.INPUT_UNAVAILABLE, source: 'reports/benchmark-sufficiency-report.json', detail: error.message });
  }

  const inputs = {};
  for (const [key, reportPath] of [
    ['semanticReport', SEMANTIC_REPORT_PATH],
    ['corpusReport', CORPUS_REPORT_PATH],
    ['phaseModelReport', PHASE_MODEL_REPORT_PATH],
  ]) {
    const { report, error } = loadInputReport(reportPath, { now, maxAgeMs });
    inputs[key] = report;
    if (error) {
      violations.push({ code: CODES.INPUT_UNAVAILABLE, source: path.relative(ROOT_DIR, reportPath), detail: error });
    }
  }

  let checks = null;
  if (violations.length === 0) {
    const found = evaluateConsistency({
      certifiedVerticals: authority.certifiedVerticals,
      semanticReport: inputs.semanticReport,
      corpusReport: inputs.corpusReport,
      phaseModelReport: inputs.phaseModelReport,
    });
    violations.push(...found);
    checks = {
      crossConsistency: found.filter((v) => v.code === CODES.CROSS_CONSISTENCY).length === 0 ? 'PASS' : 'FAIL',
      nonVacuous: found.filter((v) => v.code === CODES.NON_VACUOUS).length === 0 ? 'PASS' : 'FAIL',
    };
  }

  const report = {
    validator: 'validate-benchmark-certification-consistency',
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    certifiedVerticals: authority ? authority.certifiedVerticals : [],
    checks,
    comparedReports: {
      authority: 'reports/benchmark-sufficiency-report.json',
      semanticVersion: 'reports/benchmark-semantic-version-report.json',
      persistedCorpus: 'reports/benchmark-persisted-corpus-report.json',
      phaseModel: 'reports/benchmark-phase-model-report.json',
    },
    violations,
  };

  writeReport(report);

  console.log(
    `[benchmark-certification-consistency] status=${report.status} `
    + `certificadas=${report.certifiedVerticals.length} violacoes=${violations.length}`
  );
  for (const violation of violations) {
    console.log(`  - ${violation.code}: ${violation.vertical || violation.source || '-'} — ${violation.detail}`);
  }
  console.log(`[benchmark-certification-consistency] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  if (violations.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { CODES, DEFAULT_MAX_AGE_MS, evaluateConsistency, loadInputReport, REPORT_PATH };

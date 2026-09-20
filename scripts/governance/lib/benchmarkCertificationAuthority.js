#!/usr/bin/env node
'use strict';

/**
 * benchmarkCertificationAuthority — AUTORIDADE ÚNICA de certificação de
 * verticais de benchmark.
 *
 * Por que existe: três gates downstream (semantic-version, persisted-corpus e
 * phase-model) definiam "vertical certificada" pelo campo DECLARADO
 * `sample.claim === 'SAMPLE_SUFFICIENT'` — um campo que nenhum produtor grava
 * e cujo design proíbe gravar (suficiência é DERIVAÇÃO do engine, nunca
 * declaração; trava em tests/unit/benchmarks/benchmarkResearchHonesty.test.js).
 * Medido em 2026-09-19: o engine certificava fitness
 * (`coverageStatement.marketCertification: MARKET_SAMPLE_CERTIFIED`,
 * `certifiable: true`, `status: SAMPLE_SUFFICIENT`) enquanto os gates
 * reportavam PASS com `certifiedSamples=0` e `persistedFindingsChecked=0` —
 * um PASS vacuoso, pior que um FAIL, porque finge auditoria que nunca rodou.
 *
 * Regra canônica: uma vertical está certificada quando o RELATÓRIO CANÔNICO do
 * engine (`reports/benchmark-sufficiency-report.json`, produzido por
 * `validate:benchmark-sufficiency`) registra, para ela, as TRÊS marcas:
 *
 *   status === 'SAMPLE_SUFFICIENT'
 *   certifiable === true
 *   coverageStatement.marketCertification === 'MARKET_SAMPLE_CERTIFIED'
 *
 * FAIL-CLOSED em tudo: relatório ausente, malformado, sem `generatedAt`, mais
 * velho que a política de frescor (mesma classe da regra de staleness das
 * waves) ou internamente inconsistente (agregados top-level contradizendo a
 * derivação por vertical) é ERRO explícito — nunca um conjunto vazio
 * silencioso, que recriaria o PASS vacuoso na forma oposta.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const SUFFICIENCY_REPORT_PATH = path.join(ROOT_DIR, 'reports', 'benchmark-sufficiency-report.json');

const CERTIFIED_STATE = 'SAMPLE_SUFFICIENT';
const MARKET_CERTIFICATION_CERTIFIED = 'MARKET_SAMPLE_CERTIFIED';

/** Frescor default: 7 dias, mesma política dos relatórios das waves técnicas. */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ERROR_CODES = Object.freeze({
  REPORT_MISSING: 'BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_MISSING',
  REPORT_MALFORMED: 'BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_MALFORMED',
  REPORT_STALE: 'BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_STALE',
  REPORT_INCONSISTENT: 'BENCHMARK_CERTIFICATION_AUTHORITY_REPORT_INCONSISTENT',
});

class BenchmarkCertificationAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BenchmarkCertificationAuthorityError';
    this.code = code;
  }
}

/** As três marcas do engine, juntas. Marca parcial não certifica. */
function isCertifiedEntry(entry) {
  return Boolean(entry)
    && entry.certifiable === true
    && entry.status === CERTIFIED_STATE
    && entry.coverageStatement !== null
    && typeof entry.coverageStatement === 'object'
    && entry.coverageStatement.marketCertification === MARKET_CERTIFICATION_CERTIFIED;
}

function sortedSet(values) {
  return [...new Set(values.map(String))].sort();
}

/**
 * Deriva o conjunto de verticais certificadas de um relatório de suficiência
 * já carregado (função PURA, testável sem disco).
 *
 * Cross-check fail-closed: os agregados top-level (`sufficientVerticals`,
 * `sampleSufficientVerticals`) são publicados pelo próprio produtor; se
 * contradisserem a derivação por vertical, o relatório não é autoridade de
 * nada — erro, nunca arbitragem silenciosa.
 *
 * @param {object} report
 * @returns {string[]} ids ordenados das verticais certificadas
 */
function deriveCertifiedVerticals(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.verticals)) {
    throw new BenchmarkCertificationAuthorityError(
      ERROR_CODES.REPORT_MALFORMED,
      'relatório de suficiência sem a lista `verticals` — não é possível derivar certificação',
    );
  }

  const derived = sortedSet(report.verticals.filter(isCertifiedEntry).map((v) => v.vertical));

  for (const key of ['sufficientVerticals', 'sampleSufficientVerticals']) {
    if (!Array.isArray(report[key])) continue;
    const published = sortedSet(report[key]);
    if (JSON.stringify(published) !== JSON.stringify(derived)) {
      throw new BenchmarkCertificationAuthorityError(
        ERROR_CODES.REPORT_INCONSISTENT,
        `relatório de suficiência inconsistente: agregado \`${key}\`=[${published.join(', ')}] `
        + `contradiz a derivação por vertical=[${derived.join(', ')}] — uma autoridade que `
        + 'discorda de si mesma não certifica nada',
      );
    }
  }

  return derived;
}

/**
 * Carrega a autoridade do disco, fail-closed.
 *
 * @param {object} [options]
 * @param {string} [options.reportPath]  default: reports/benchmark-sufficiency-report.json
 * @param {number} [options.now]         epoch ms (injetável para testes)
 * @param {number} [options.maxAgeMs]    frescor máximo do relatório
 * @returns {{ certifiedVerticals: string[], generatedAt: string, commit: string|null,
 *             status: string|null, reportPath: string }}
 */
function loadCertificationAuthority({
  reportPath = SUFFICIENCY_REPORT_PATH,
  now = Date.now(),
  maxAgeMs = Number(process.env.BENCHMARK_CERTIFICATION_AUTHORITY_MAX_AGE_MS) || DEFAULT_MAX_AGE_MS,
} = {}) {
  if (!fs.existsSync(reportPath)) {
    throw new BenchmarkCertificationAuthorityError(
      ERROR_CODES.REPORT_MISSING,
      `relatório canônico de suficiência ausente em ${path.relative(ROOT_DIR, reportPath)} — `
      + 'rode `npm run validate:benchmark-sufficiency` antes deste gate; sem o relatório do '
      + 'engine NÃO existe conjunto de verticais certificadas (e lista vazia silenciosa é proibida)',
    );
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    throw new BenchmarkCertificationAuthorityError(
      ERROR_CODES.REPORT_MALFORMED,
      `relatório de suficiência inválido: ${error.message}`,
    );
  }

  const generatedAtMs = Date.parse(report && report.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    throw new BenchmarkCertificationAuthorityError(
      ERROR_CODES.REPORT_MALFORMED,
      'relatório de suficiência sem `generatedAt` válido — frescor não se assume, se prova',
    );
  }
  if (now - generatedAtMs > maxAgeMs) {
    throw new BenchmarkCertificationAuthorityError(
      ERROR_CODES.REPORT_STALE,
      `relatório de suficiência STALE (generatedAt=${report.generatedAt}, `
      + `idade máxima=${maxAgeMs}ms) — evidência vencida não certifica; `
      + 'rode `npm run validate:benchmark-sufficiency` para renovar',
    );
  }

  return {
    certifiedVerticals: deriveCertifiedVerticals(report),
    generatedAt: report.generatedAt,
    commit: typeof report.commit === 'string' ? report.commit : null,
    status: typeof report.status === 'string' ? report.status : null,
    reportPath,
  };
}

module.exports = {
  CERTIFIED_STATE,
  MARKET_CERTIFICATION_CERTIFIED,
  DEFAULT_MAX_AGE_MS,
  ERROR_CODES,
  SUFFICIENCY_REPORT_PATH,
  BenchmarkCertificationAuthorityError,
  deriveCertifiedVerticals,
  isCertifiedEntry,
  loadCertificationAuthority,
};

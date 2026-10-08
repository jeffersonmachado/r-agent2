'use strict';

/**
 * cvss — cálculo do score base de CVSS v3.0/v3.1 a partir do VETOR.
 *
 * Módulo PURO. Existe por um defeito medido em 2026-10-08: o GitHub Advisory
 * Database publica a severidade como VETOR (`CVSS:3.1/AV:N/AC:H/...`), não como
 * número. O normalizador só aceitava número, então todo achado cujo score vinha
 * como vetor caía para a severidade assumida (`MEDIUM`) — e um CRITICAL/HIGH
 * **não bloqueava o Release Security Gate**. Subestimar severidade é a falha
 * mais perigosa possível num gate de segurança: ele aprova o que devia barrar.
 *
 * O cálculo é o oficial do FIRST (spec CVSS v3.1 §7.1). Nada é estimado: vetor
 * inválido devolve `null` e a severidade declarada pela fonte é preservada.
 */

const SEVERITY_BANDS = Object.freeze([
  { min: 9.0, severity: 'CRITICAL' },
  { min: 7.0, severity: 'HIGH' },
  { min: 4.0, severity: 'MEDIUM' },
  { min: 0.1, severity: 'LOW' },
  { min: 0.0, severity: 'INFORMATIONAL' },
]);

const METRIC_WEIGHTS = Object.freeze({
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  PR_UNCHANGED: { N: 0.85, L: 0.62, H: 0.27 },
  PR_CHANGED: { N: 0.85, L: 0.68, H: 0.5 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
});

/**
 * Arredondamento oficial do FIRST: para CIMA em 1 casa decimal.
 * A normalização intermediária existe para o resultado de ponto flutuante
 * (ex.: 4.000000000000001) não virar 4.1 por acidente.
 */
function roundUp(value) {
  const normalized = Math.round(value * 100000) / 100000;
  return Math.ceil(normalized * 10) / 10;
}

/** Parseia `CVSS:3.1/AV:N/AC:L/...` em métricas. `null` se inválido/incompleto. */
function parseVector(vector) {
  if (typeof vector !== 'string') return null;
  const match = /^CVSS:(3\.[01])\/(.+)$/i.exec(vector.trim());
  if (!match) return null;
  const metrics = {};
  for (const part of match[2].split('/')) {
    const [key, value] = part.split(':');
    if (!key || !value) continue;
    metrics[key.toUpperCase()] = value.toUpperCase();
  }
  const required = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];
  for (const key of required) {
    if (!metrics[key]) return null;
  }
  if (!['U', 'C'].includes(metrics.S)) return null;
  return { version: match[1], metrics };
}

/**
 * Score base CVSS v3.0/v3.1 (fórmula oficial do FIRST).
 * @returns {number|null} `null` quando o vetor não é válido — nunca inventa score.
 */
function baseScore(vector) {
  const parsed = typeof vector === 'string' ? parseVector(vector) : vector;
  if (!parsed) return null;
  const { metrics } = parsed;

  const scopeChanged = metrics.S === 'C';
  const av = METRIC_WEIGHTS.AV[metrics.AV];
  const ac = METRIC_WEIGHTS.AC[metrics.AC];
  const ui = METRIC_WEIGHTS.UI[metrics.UI];
  const pr = (scopeChanged ? METRIC_WEIGHTS.PR_CHANGED : METRIC_WEIGHTS.PR_UNCHANGED)[metrics.PR];
  const c = METRIC_WEIGHTS.CIA[metrics.C];
  const i = METRIC_WEIGHTS.CIA[metrics.I];
  const a = METRIC_WEIGHTS.CIA[metrics.A];
  if ([av, ac, ui, pr, c, i, a].some((value) => value === undefined)) return null;

  const iss = 1 - ((1 - c) * (1 - i) * (1 - a));
  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * ((iss - 0.02) ** 15)
    : 6.42 * iss;
  if (impact <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp(raw);
}

/** Severidade a partir de um score (faixas oficiais do FIRST). */
function severityFromScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  for (const band of SEVERITY_BANDS) {
    if (score >= band.min) return band.severity;
  }
  return null;
}

/** Atalho: vetor → `{score, severity}` ou `null`. */
function evaluateVector(vector) {
  const score = baseScore(vector);
  if (score === null) return null;
  return { score, severity: severityFromScore(score) };
}

module.exports = {
  SEVERITY_BANDS,
  METRIC_WEIGHTS,
  roundUp,
  parseVector,
  baseScore,
  severityFromScore,
  evaluateVector,
};

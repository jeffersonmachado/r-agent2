'use strict';

/**
 * marketQueries — queries de varredura de mercado DERIVADAS do contexto de
 * mercado DECLARADO no config da vertical (`config/benchmarks/<vertical>.json`
 * → `marketContext`).
 *
 * Por que isto existe (2026-09-15): a varredura real da vertical fitness usava
 * queries genéricas (`fitness software gestão mercado fornecedores`) e o
 * universo descoberto veio poluído com lojas de roupa e páginas de Wikipedia —
 * o termo "fitness" sozinho não denota a CATEGORIA de mercado (software de
 * gestão de academias). As queries precisam nascer do contexto de mercado que
 * a vertical DECLARA: termos de categoria (pt-BR + en) e padrões de descoberta
 * por concorrente conhecido ("<competitor> alternatives").
 *
 * Regras:
 *  - CONFIG-DRIVEN: nada aqui nomeia fornecedor; os concorrentes vêm dos
 *    benchmarks do sample e os termos vêm de `marketContext`;
 *  - DETERMINÍSTICO: mesma entrada → mesma lista, na ordem declarada, sem
 *    relógio nem rede;
 *  - sem `marketContext` no sample, o comportamento anterior (queries
 *    genéricas derivadas do id da vertical) é preservado — o módulo nunca
 *    inventa contexto que a vertical não declarou.
 *
 * Este módulo é PURO (zero I/O).
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  return list(value).map((item) => String(item ?? '').trim()).filter(Boolean);
}

/**
 * Nome de CONCORRENTE utilizável em query: o nome declarado no benchmark sem o
 * parêntese de aliases ("EVO (W12 / ABC Evo)" → "EVO"). Determinístico e
 * derivado do config — nunca um apelido inventado pelo agente.
 */
function competitorQueryName(benchmark) {
  const raw = String(benchmark?.name || benchmark?.id || '');
  return raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

const DEFAULT_COMPETITOR_PATTERNS = Object.freeze([
  '{competitor} alternatives',
  '{competitor} competitors',
]);

/**
 * Monta as queries de varredura de mercado de UMA vertical.
 *
 * Ordem determinística:
 *   1. `marketContext.categoryTerms` — termos de categoria, na ordem declarada
 *      (ex.: 'gym management software', 'software para academia gestão');
 *   2. padrões de descoberta por concorrente — `marketContext.competitorPatterns`
 *      (default: '<c> alternatives', '<c> competitors') aplicados a CADA
 *      benchmark do sample, na ordem do sample;
 *   3. fallback sem contexto declarado: as queries genéricas anteriores.
 *
 * @returns {string[]} queries sem duplicatas exatas, na ordem construída.
 */
function buildMarketQueries({ vertical, sample } = {}) {
  const verticalId = String(vertical ?? '').trim();
  const context = sample?.marketContext && typeof sample.marketContext === 'object'
    ? sample.marketContext
    : null;

  if (!context) {
    return [
      `${verticalId} software gestão mercado fornecedores`,
      `${verticalId} platform competitors official`,
    ];
  }

  const queries = [];
  const seen = new Set();
  const push = (query) => {
    const normalized = String(query ?? '').replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queries.push(normalized);
  };

  for (const term of stringList(context.categoryTerms)) push(term);

  const patterns = stringList(context.competitorPatterns).length > 0
    ? stringList(context.competitorPatterns)
    : [...DEFAULT_COMPETITOR_PATTERNS];
  for (const benchmark of list(sample?.benchmarks)) {
    const competitor = competitorQueryName(benchmark);
    if (!competitor) continue;
    for (const pattern of patterns) {
      if (!pattern.includes('{competitor}')) continue;
      push(pattern.replaceAll('{competitor}', competitor));
    }
  }

  return queries.length > 0
    ? queries
    : [`${verticalId} software gestão mercado fornecedores`, `${verticalId} platform competitors official`];
}

module.exports = {
  DEFAULT_COMPETITOR_PATTERNS,
  competitorQueryName,
  buildMarketQueries,
};

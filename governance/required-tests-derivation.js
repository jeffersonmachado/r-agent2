'use strict';

/**
 * required-tests-derivation.js — NÚCLEO PURO da derivação de estado dos TESTES OBRIGATÓRIOS V2.
 *
 * Recebe a lista de requisitos (V2-01..V2-42, com enunciado e prova declarada) e duas funções de
 * leitura, e devolve a classificação de CADA item a partir do que foi REALMENTE observado.
 *
 * Regras que não podem ser afrouxadas:
 *   - nenhum status é aceito como entrada: ele é derivado do valor observado;
 *   - suíte que não aparece na execução autoritativa é NOT_EXECUTED (nunca "cobertura por existir");
 *   - relatório ausente ⇒ UNPROVEN (nunca "aprovado por falta de dado");
 *   - evidência mais velha que o TTL ⇒ STALE (evidência vencida não conta como prova);
 *   - impedimento externo DECLARADO ⇒ BLOCKED_EXTERNAL (nunca convertido em PASS).
 *
 * Funções de I/O são injetadas: este módulo é puro e não lê arquivos nem relógio.
 */

const DEFAULT_PROVEN_VALUES = ['GO', 'GREEN', 'PASS', 'HEALTHY', 'COMPLETE', 'VERIFIED', 'PASS_CORE'];
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Estados terminais negativos (bloqueiam o gate) — mantidos explícitos, não inferidos. */
const BLOCKING_CLASSIFICATIONS = ['GAP', 'FAILED', 'NOT_EXECUTED', 'UNPROVEN', 'STALE', 'NOT_IN_MANIFEST'];

function normalizeValue(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toUpperCase();
}

/**
 * Classifica UM requisito.
 *
 * @param {object} item            requisito ({id, requirement, suites, reports, gapReason, externalBlocker})
 * @param {object} ctx
 * @param {(suite: string) => ({state: string}|null)} ctx.suiteState  estado real da suíte na execução autoritativa
 * @param {(report: string) => ({value: string|null, generatedAt: string|null, exists: boolean})} ctx.reportState
 * @param {string[]} [ctx.provenValues]
 * @param {number}   [ctx.staleAfterMs]
 * @param {number}   [ctx.nowMs]
 * @returns {{id: string, classification: string, blocking: boolean, suites: object[], reports: object[], detail: string}}
 */
function classifyRequiredTest(item, ctx = {}) {
  const id = item && item.id;
  const suites = Array.isArray(item && item.suites) ? item.suites : [];
  const reports = Array.isArray(item && item.reports) ? item.reports : [];
  const provenValues = (ctx.provenValues || DEFAULT_PROVEN_VALUES).map(normalizeValue);
  const staleAfterMs = Number.isFinite(ctx.staleAfterMs) ? ctx.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const suiteState = typeof ctx.suiteState === 'function' ? ctx.suiteState : () => null;
  const reportState = typeof ctx.reportState === 'function' ? ctx.reportState : () => ({ exists: false });

  const suiteRows = suites.map((suite) => {
    const observed = suiteState(suite);
    const state = observed && observed.state ? normalizeValue(observed.state) : null;
    return {
      suite,
      state: state || 'NOT_EXECUTED',
      pass: state === 'PASS',
    };
  });

  const reportRows = reports.map((report) => {
    const observed = reportState(report) || {};
    const value = normalizeValue(observed.value);
    const generatedAt = observed.generatedAt || null;
    const ageMs = generatedAt ? nowMs - Date.parse(generatedAt) : null;
    const stale = Number.isFinite(ageMs) ? ageMs > staleAfterMs : false;
    const proven = observed.exists === true && value !== null && provenValues.includes(value);
    return {
      report,
      exists: observed.exists === true,
      value,
      generatedAt,
      ageMs,
      stale,
      proven,
    };
  });

  const finish = (classification, detail) => ({
    id,
    requirement: item && item.requirement,
    classification,
    blocking: BLOCKING_CLASSIFICATIONS.includes(classification),
    suites: suiteRows,
    reports: reportRows,
    detail,
  });

  // Impedimento externo DECLARADO tem precedência: nunca vira PASS, mas também não é defeito de código.
  if (item && item.externalBlocker && item.externalBlocker.reason) {
    return finish('BLOCKED_EXTERNAL', item.externalBlocker.reason);
  }

  // Gap declarado: requisito sem prova alguma. Não é silenciado.
  if (suiteRows.length === 0 && reportRows.length === 0) {
    return finish('GAP', item.gapReason || 'requisito sem prova declarada');
  }

  const failed = suiteRows.filter((row) => row.state === 'FAIL' || row.state === 'FAILED');
  if (failed.length > 0) {
    return finish('FAILED', `suíte(s) com falha: ${failed.map((row) => row.suite).join(', ')}`);
  }

  const notExecuted = suiteRows.filter((row) => row.state === 'NOT_EXECUTED');
  if (notExecuted.length > 0) {
    return finish(
      'NOT_EXECUTED',
      `suíte(s) sem execução autoritativa registrada: ${notExecuted.map((row) => row.suite).join(', ')}`
    );
  }

  const missingReports = reportRows.filter((row) => !row.exists);
  if (missingReports.length > 0) {
    return finish('UNPROVEN', `relatório de prova ausente: ${missingReports.map((row) => row.report).join(', ')}`);
  }

  const staleReports = reportRows.filter((row) => row.stale);
  if (staleReports.length > 0) {
    return finish(
      'STALE',
      `evidência vencida (>${Math.round(staleAfterMs / 86400000)}d): ${staleReports.map((row) => row.report).join(', ')}`
    );
  }

  const unprovenReports = reportRows.filter((row) => !row.proven);
  if (unprovenReports.length > 0) {
    return finish(
      'UNPROVEN',
      `relatório sem valor de aprovação (${provenValues.join('/')}): ${unprovenReports
        .map((row) => `${row.report}=${row.value === null ? '(sem status)' : row.value}`)
        .join(', ')}`
    );
  }

  const provenSuites = suiteRows.length;
  const provenReports = reportRows.length;
  return finish(
    'PROVEN',
    `${provenSuites} suíte(s) PASS${provenReports > 0 ? ` + ${provenReports} relatório(s) aprovado(s)` : ''}`
  );
}

/**
 * Deriva o estado de TODOS os requisitos.
 *
 * @returns {{status: string, total: number, counts: object, unresolvedIds: string[], items: object[]}}
 */
function deriveRequiredTests({ items, suiteState, reportState, provenValues, staleAfterMs, nowMs } = {}) {
  const list = Array.isArray(items) ? items : [];
  const ctx = { suiteState, reportState, provenValues, staleAfterMs, nowMs };
  const derived = list.map((item) => classifyRequiredTest(item, ctx));

  const counts = {};
  for (const entry of derived) {
    counts[entry.classification] = (counts[entry.classification] || 0) + 1;
  }

  const unresolvedIds = derived.filter((entry) => entry.blocking).map((entry) => entry.id);
  const status = unresolvedIds.length === 0 && derived.length > 0 ? 'PASS' : 'FAIL';

  return { status, total: derived.length, counts, unresolvedIds, items: derived };
}

module.exports = {
  classifyRequiredTest,
  deriveRequiredTests,
  normalizeValue,
  DEFAULT_PROVEN_VALUES,
  DEFAULT_STALE_AFTER_MS,
  BLOCKING_CLASSIFICATIONS,
};

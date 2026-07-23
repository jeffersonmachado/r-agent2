'use strict';

/**
 * Learning Core — Assessment Engine (núcleo puro, zero I/O).
 *
 * Avalia competências por EVIDÊNCIA (nunca provas/questionários), compondo:
 *  - os componentes já calculados pelo competency-engine (precisão, tempo,
 *    autonomia, consistência) e
 *  - a capacidade de RECUPERAÇÃO, derivada da sequência de eventos: um erro
 *    conta como recuperado quando há evento de sucesso posterior na mesma
 *    skill dentro de RECOVERY_WINDOW_MS.
 *
 * Critérios avaliados por skill (missão Learning Core):
 *  precisão, tempo, autonomia, número de erros, consistência, capacidade de
 *  recuperação, exceções (api_call com status >= 500).
 *
 * Toda a leitura de ledger e persistência fica no service de orquestração
 * (api/modules/learning-core/certificationService.js).
 */

const { isErrorEvent } = require('../competency-engine');

const TYPE_PREFIX = 'learning.interaction.';
const RECOVERY_WINDOW_MS = 24 * 3600000;

/**
 * Thresholds padrão de certificação. Componente `null` (sem evidência)
 * bloqueia a certificação — competência só é comprovada com evidência em
 * TODOS os critérios aplicáveis. `recuperacao` é a exceção: null significa
 * "sem erros no período" (não aplicável, não bloqueia).
 */
const DEFAULT_THRESHOLDS = Object.freeze({
  minEvents: 20,
  precisao: 0.9,
  autonomia: 0.8,
  consistencia: 0.6,
  tempo: 0.4,
  recuperacao: 0.5,
});

function round4(value) {
  return value === null ? null : Math.round(value * 10000) / 10000;
}

function shortType(type) {
  const t = String(type || '');
  return t.startsWith(TYPE_PREFIX) ? t.slice(TYPE_PREFIX.length) : t;
}

function toTime(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const occurredAtMs = toTime(raw.occurredAt !== undefined ? raw.occurredAt : raw.occurred_at);
  if (occurredAtMs === null) return null;
  const status = raw.status !== undefined && raw.status !== null ? raw.status : payload.status;
  return {
    id: raw.id || null,
    type: shortType(raw.type),
    route: payload.route || null,
    status: status != null && Number.isFinite(Number(status)) ? Number(status) : null,
    errorCode: raw.errorCode || payload.errorCode || null,
    occurredAtMs,
  };
}

function isExceptionEvent(event) {
  return event.type === 'api_call' && event.status !== null && event.status >= 500;
}

/**
 * Computa recuperação e exceções por skill a partir da sequência de eventos.
 *
 * @param {object} args
 * @param {Array}  args.events  eventos learning.interaction.* do usuário
 * @param {Object<string,string>} args.routeSkillMap  rota -> skillKey
 * @param {number} [args.windowMs]  janela de recuperação (default 24h)
 * @returns {Object<string, {errorCount, recoveredCount, recoveryRate, exceptionCount}>}
 */
function computeRecovery({ events, routeSkillMap, windowMs } = {}) {
  const map = routeSkillMap || {};
  const window = Number.isFinite(windowMs) ? windowMs : RECOVERY_WINDOW_MS;

  const normalized = (Array.isArray(events) ? events : [])
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  const bySkill = new Map();
  for (const event of normalized) {
    if (!event.route) continue;
    const skillKey = map[event.route];
    if (!skillKey) continue;
    if (!bySkill.has(skillKey)) bySkill.set(skillKey, []);
    bySkill.get(skillKey).push(event);
  }

  const result = {};
  for (const [skillKey, skillEvents] of bySkill.entries()) {
    let errorCount = 0;
    let recoveredCount = 0;
    let exceptionCount = 0;

    for (let i = 0; i < skillEvents.length; i += 1) {
      const event = skillEvents[i];
      if (isExceptionEvent(event)) exceptionCount += 1;
      if (!isErrorEvent(event)) continue;
      errorCount += 1;
      // Recuperado = existe sucesso posterior na mesma skill dentro da janela.
      for (let j = i + 1; j < skillEvents.length; j += 1) {
        const later = skillEvents[j];
        if (later.occurredAtMs - event.occurredAtMs > window) break;
        if (!isErrorEvent(later)) {
          recoveredCount += 1;
          break;
        }
      }
    }

    result[skillKey] = {
      errorCount,
      recoveredCount,
      recoveryRate: errorCount > 0 ? round4(recoveredCount / errorCount) : null,
      exceptionCount,
    };
  }

  return result;
}

function evaluateCriterion(value, threshold) {
  if (value === null || value === undefined) {
    return { value: null, threshold, met: false, reason: 'sem_evidencia' };
  }
  return { value, threshold, met: value >= threshold, reason: value >= threshold ? null : 'abaixo_do_threshold' };
}

/**
 * Avalia competências contra os thresholds de certificação.
 *
 * @param {object} args
 * @param {Array}  args.competencies  saída de computeCompetencies (ou rows serializadas)
 * @param {Object} args.recoveryBySkill  saída de computeRecovery
 * @param {Object} [args.thresholds]  overrides de DEFAULT_THRESHOLDS
 * @returns {Array<{skillKey, criteria, evaluations, certifiable, missingEvidence, evidenceRefs}>}
 */
function assessSkills({ competencies, recoveryBySkill, thresholds } = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const recovery = recoveryBySkill || {};

  return (Array.isArray(competencies) ? competencies : []).map((competency) => {
    const components = competency.components || {};
    const rec = recovery[competency.skillKey] || {
      errorCount: 0,
      recoveredCount: 0,
      recoveryRate: null,
      exceptionCount: 0,
    };

    const criteria = {
      precisao: components.precision ?? null,
      tempo: components.tempo ?? null,
      autonomia: components.autonomia ?? null,
      consistencia: components.consistencia ?? null,
      recuperacao: rec.recoveryRate,
      erros: rec.errorCount,
      excecoes: rec.exceptionCount,
    };

    const evaluations = {
      precisao: evaluateCriterion(criteria.precisao, limits.precisao),
      tempo: evaluateCriterion(criteria.tempo, limits.tempo),
      autonomia: evaluateCriterion(criteria.autonomia, limits.autonomia),
      consistencia: evaluateCriterion(criteria.consistencia, limits.consistencia),
      // Sem erros no período => recuperação não aplicável (não bloqueia).
      recuperacao: criteria.recuperacao === null
        ? { value: null, threshold: limits.recuperacao, met: true, reason: 'nao_aplicavel' }
        : evaluateCriterion(criteria.recuperacao, limits.recuperacao),
    };

    const missingEvidence = [];
    if ((competency.eventCount || 0) < limits.minEvents) {
      missingEvidence.push(`eventos_insuficientes:${competency.eventCount || 0}<${limits.minEvents}`);
    }
    for (const [criterion, evaluation] of Object.entries(evaluations)) {
      if (!evaluation.met) missingEvidence.push(`${criterion}:${evaluation.reason}`);
    }

    return {
      skillKey: competency.skillKey,
      score: competency.score ?? null,
      eventCount: competency.eventCount || 0,
      criteria,
      evaluations,
      certifiable: missingEvidence.length === 0,
      missingEvidence,
      evidenceRefs: Array.isArray(competency.evidenceRefs) ? competency.evidenceRefs.slice(0, 20) : [],
    };
  }).sort((a, b) => a.skillKey.localeCompare(b.skillKey));
}

module.exports = {
  computeRecovery,
  assessSkills,
  DEFAULT_THRESHOLDS,
  RECOVERY_WINDOW_MS,
};

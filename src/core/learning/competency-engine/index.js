'use strict';

/**
 * Learning Core — Competency Engine (núcleo puro, zero I/O).
 *
 * Computa competências de um usuário por skill a partir dos eventos
 * `learning.interaction.*` ingeridos na Fase 0. Mesma disciplina do
 * `engine/`: funções puras e determinísticas; toda a leitura de ledger,
 * classificação de rotas via IA e persistência fica no service de
 * orquestração (api/modules/learning-core/competencyService.js).
 *
 * Componentes (todos em 0..1; `null` quando não há dados — sai da média):
 *  - precision:    1 - (eventos com erro / total). Erro = type `error`,
 *                  `api_call` com status >= 400 ou errorCode, ou
 *                  `flow_abandoned`.
 *  - coverage:     rotas distintas da skill visitadas / rotas conhecidas da
 *                  skill (de `knownRoutesBySkill`; skill sem rotas
 *                  conhecidas -> null).
 *  - tempo:        mediana de durationMs das navegações da skill vs mediana
 *                  global do próprio usuário (razão invertida global/skill,
 *                  clamp 0..1; sem dados -> null). Mais rápido que a própria
 *                  média => mais alto.
 *  - autonomia:    flow_completed / (flow_completed + flow_abandoned + error)
 *                  quando há eventos de fluxo/erro; senão null.
 *  - consistencia: 1 - (desvio padrão dos durationMs / média), clamp 0..1;
 *                  sem dados ou média zero -> null.
 *
 * Score: média ponderada dos componentes não-nulos com pesos
 * precision 0.35, autonomia 0.25, coverage 0.2, tempo 0.1, consistencia 0.1
 * (renormalizada quando algum componente é null).
 *
 * evidenceRefs: até 20 ids de eventos mais relevantes — erros primeiro,
 * depois os mais recentes.
 */

const TYPE_PREFIX = 'learning.interaction.';

const WEIGHTS = Object.freeze({
  precision: 0.35,
  autonomia: 0.25,
  coverage: 0.2,
  tempo: 0.1,
  consistencia: 0.1,
});

const MAX_EVIDENCE_REFS = 20;

function clamp01(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

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

function toIso(value) {
  const time = toTime(value);
  return time === null ? null : new Date(time).toISOString();
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Erro operacional: type `error`, `flow_abandoned`, ou `api_call` com
 * status >= 400 / errorCode presente. Aceita tanto eventos crus (com
 * `payload`) quanto eventos já normalizados pelo engine.
 */
function isErrorEvent(event) {
  const type = shortType(event.type);
  if (type === 'error' || type === 'flow_abandoned') return true;
  if (type === 'api_call') {
    const rawStatus = event.status !== undefined && event.status !== null
      ? event.status
      : (event.payload && event.payload.status);
    const status = Number(rawStatus);
    const errorCode = event.errorCode || (event.payload && event.payload.errorCode);
    return (Number.isFinite(status) && status >= 400) || Boolean(errorCode);
  }
  return false;
}

/**
 * Normaliza um evento do ledger para a forma interna do engine.
 * Aceita tanto a linha do ledger (occurred_at) quanto objetos já
 * serializados (occurredAt). Retorna null para evento inválido.
 */
function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const occurredAtMs = toTime(raw.occurredAt !== undefined ? raw.occurredAt : raw.occurred_at);
  if (occurredAtMs === null) return null;
  const durationMs = Number(payload.durationMs);
  return {
    id: raw.id || null,
    type: shortType(raw.type),
    route: payload.route || null,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    status: payload.status != null ? Number(payload.status) : null,
    errorCode: payload.errorCode || null,
    flowId: payload.flowId || null,
    occurredAtMs,
  };
}

/**
 * Computa as competências por skill de um usuário.
 *
 * @param {object} args
 * @param {Array}  args.events  eventos learning.interaction.* do usuário
 * @param {Object<string,string>} args.routeSkillMap  rota -> skillKey
 * @param {Object<string,string[]>} args.knownRoutesBySkill  skillKey -> rotas conhecidas
 * @param {Date} [args.now]  referência temporal (determinismo em testes)
 * @returns {Array<{skillKey, score, components, evidenceRefs, eventCount, firstSeenAt, lastSeenAt}>}
 */
function computeCompetencies({ events, routeSkillMap, knownRoutesBySkill, now } = {}) {
  void now; // reservado para decaimento temporal futuro; cálculo atual é atemporal
  const map = routeSkillMap || {};
  const knownRoutes = knownRoutesBySkill || {};

  const normalized = (Array.isArray(events) ? events : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);

  // Mediana global de navegação do próprio usuário (baseline de tempo).
  const globalNavDurations = normalized
    .filter((e) => e.type === 'navigation' && e.durationMs !== null)
    .map((e) => e.durationMs);
  const globalNavMedian = median(globalNavDurations);

  const bySkill = new Map();
  for (const event of normalized) {
    if (!event.route) continue;
    const skillKey = map[event.route];
    if (!skillKey) continue;
    if (!bySkill.has(skillKey)) bySkill.set(skillKey, []);
    bySkill.get(skillKey).push(event);
  }

  const competencies = [];
  for (const [skillKey, skillEvents] of bySkill.entries()) {
    const total = skillEvents.length;
    const errorEvents = skillEvents.filter(isErrorEvent);

    // precision
    const precision = clamp01(1 - errorEvents.length / total);

    // coverage
    const known = Array.isArray(knownRoutes[skillKey]) ? knownRoutes[skillKey] : [];
    let coverage = null;
    if (known.length > 0) {
      const visited = new Set(skillEvents.map((e) => e.route).filter(Boolean));
      const visitedKnown = known.filter((route) => visited.has(route)).length;
      coverage = clamp01(visitedKnown / known.length);
    }

    // tempo (mediana das navegações da skill vs mediana global do usuário)
    const skillNavDurations = skillEvents
      .filter((e) => e.type === 'navigation' && e.durationMs !== null)
      .map((e) => e.durationMs);
    const skillNavMedian = median(skillNavDurations);
    let tempo = null;
    if (skillNavMedian !== null && skillNavMedian > 0 && globalNavMedian !== null && globalNavMedian > 0) {
      tempo = clamp01(globalNavMedian / skillNavMedian);
    }

    // autonomia
    const flowCompleted = skillEvents.filter((e) => e.type === 'flow_completed').length;
    const flowAbandoned = skillEvents.filter((e) => e.type === 'flow_abandoned').length;
    const typedErrors = skillEvents.filter((e) => e.type === 'error').length;
    const flowTotal = flowCompleted + flowAbandoned + typedErrors;
    const autonomia = flowTotal > 0 ? clamp01(flowCompleted / flowTotal) : null;

    // consistencia (sobre todos os durationMs da skill)
    const durations = skillEvents.filter((e) => e.durationMs !== null).map((e) => e.durationMs);
    let consistencia = null;
    if (durations.length >= 2) {
      const mean = durations.reduce((sum, v) => sum + v, 0) / durations.length;
      if (mean > 0) {
        const variance = durations.reduce((sum, v) => sum + (v - mean) ** 2, 0) / durations.length;
        consistencia = clamp01(1 - Math.sqrt(variance) / mean);
      }
    }

    const components = {
      precision: round4(precision),
      coverage: round4(coverage),
      tempo: round4(tempo),
      autonomia: round4(autonomia),
      consistencia: round4(consistencia),
    };

    // score: média ponderada renormalizada sobre componentes não-nulos
    let weightedSum = 0;
    let weightTotal = 0;
    for (const [component, weight] of Object.entries(WEIGHTS)) {
      if (components[component] !== null) {
        weightedSum += components[component] * weight;
        weightTotal += weight;
      }
    }
    const score = weightTotal > 0 ? round4(weightedSum / weightTotal) : 0;

    // evidenceRefs: erros primeiro, depois os mais recentes; até 20 ids.
    const ranked = skillEvents
      .slice()
      .sort((a, b) => {
        const errDiff = Number(isErrorEvent(b)) - Number(isErrorEvent(a));
        if (errDiff !== 0) return errDiff;
        return b.occurredAtMs - a.occurredAtMs;
      });
    const evidenceRefs = [];
    for (const event of ranked) {
      if (evidenceRefs.length >= MAX_EVIDENCE_REFS) break;
      if (event.id && !evidenceRefs.includes(event.id)) evidenceRefs.push(event.id);
    }

    competencies.push({
      skillKey,
      score,
      components,
      evidenceRefs,
      eventCount: total,
      firstSeenAt: toIso(skillEvents[0].occurredAtMs),
      lastSeenAt: toIso(skillEvents[total - 1].occurredAtMs),
    });
  }

  return competencies.sort((a, b) => a.skillKey.localeCompare(b.skillKey));
}

/**
 * Agrega competências em um perfil de aprendizado.
 *
 * @param {Array} competencies  saída de computeCompetencies
 * @returns {{ dominantSkills: Array, weakSkills: Array, totals: object }}
 *   dominantSkills: top 3 por score com >= 10 eventos.
 *   weakSkills: score < 0.5 com >= 5 eventos.
 */
function buildProfile(competencies) {
  const list = Array.isArray(competencies) ? competencies.slice() : [];

  const dominantSkills = list
    .filter((c) => c.eventCount >= 10)
    .sort((a, b) => b.score - a.score || a.skillKey.localeCompare(b.skillKey))
    .slice(0, 3)
    .map((c) => ({ skillKey: c.skillKey, score: c.score, eventCount: c.eventCount }));

  const weakSkills = list
    .filter((c) => c.score < 0.5 && c.eventCount >= 5)
    .sort((a, b) => a.score - b.score || a.skillKey.localeCompare(b.skillKey))
    .map((c) => ({ skillKey: c.skillKey, score: c.score, eventCount: c.eventCount }));

  const totalEvents = list.reduce((sum, c) => sum + c.eventCount, 0);
  const averageScore = list.length > 0
    ? round4(list.reduce((sum, c) => sum + c.score, 0) / list.length)
    : null;

  return {
    dominantSkills,
    weakSkills,
    totals: {
      skills: list.length,
      events: totalEvents,
      averageScore,
    },
  };
}

module.exports = {
  computeCompetencies,
  buildProfile,
  isErrorEvent,
  WEIGHTS,
  MAX_EVIDENCE_REFS,
};

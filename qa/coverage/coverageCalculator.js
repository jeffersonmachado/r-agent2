'use strict';

/**
 * Calculadora pura de métricas de cobertura.
 *
 * Convenções:
 * - Elegíveis = todos os itens exceto NOT_APPLICABLE.
 * - Percentuais em escala 0–100 com 1 casa decimal (round half up).
 * - Quando não há elegíveis/concluídos, o percentual é 100.
 */

const {
  COVERAGE_STATES,
  COUNTS_AS_VISITED,
  COUNTS_AS_VALIDATED,
} = require('./coverageStates');
const { CRITICALITY_WEIGHTS } = require('./traceabilityGraph');

/** Pesos default do score consolidado de onda. */
const DEFAULT_WAVE_WEIGHTS = Object.freeze({
  journeys: 0.40,
  pathsTransitions: 0.20,
  apisContracts: 0.15,
  pages: 0.10,
  models: 0.10,
  resilience: 0.05,
});

/**
 * Presets de pesos por foco da onda:
 * - business-journey: default, foco em jornadas de negócio.
 * - database-integrity: peso maior em models (models/fields/relations/migrations).
 * - security: peso maior em autorização/isolamento (mapeadas ao grupo apisContracts).
 */
const WAVE_WEIGHT_PRESETS = Object.freeze({
  'business-journey': DEFAULT_WAVE_WEIGHTS,
  'database-integrity': Object.freeze({
    journeys: 0.20,
    pathsTransitions: 0.10,
    apisContracts: 0.10,
    pages: 0.05,
    models: 0.45,
    resilience: 0.10,
  }),
  security: Object.freeze({
    journeys: 0.20,
    pathsTransitions: 0.15,
    apisContracts: 0.35,
    pages: 0.05,
    models: 0.15,
    resilience: 0.10,
  }),
});

/**
 * Mapeamento de dimensões granulares (campo `dimension` dos itens) para os
 * grupos do score de onda:
 * - journeys: journey, journeys
 * - pathsTransitions: path, paths, state, states, transition, transitions
 * - apisContracts: api, apis, contract, contracts, service, services,
 *   authorization, isolation, tenancy (dimensões de segurança de acesso)
 * - pages: page, pages
 * - models: model, models, field, fields, relation, relations, migration, migrations
 * - resilience: resilience, event, events, outcome, outcomes, seed, seeds, chaos
 */
const DIMENSION_TO_WAVE_GROUP = Object.freeze({
  journey: 'journeys',
  journeys: 'journeys',
  path: 'pathsTransitions',
  paths: 'pathsTransitions',
  state: 'pathsTransitions',
  states: 'pathsTransitions',
  transition: 'pathsTransitions',
  transitions: 'pathsTransitions',
  api: 'apisContracts',
  apis: 'apisContracts',
  contract: 'apisContracts',
  contracts: 'apisContracts',
  service: 'apisContracts',
  services: 'apisContracts',
  authorization: 'apisContracts',
  isolation: 'apisContracts',
  tenancy: 'apisContracts',
  page: 'pages',
  pages: 'pages',
  model: 'models',
  models: 'models',
  field: 'models',
  fields: 'models',
  relation: 'models',
  relations: 'models',
  migration: 'models',
  migrations: 'models',
  resilience: 'resilience',
  event: 'resilience',
  events: 'resilience',
  outcome: 'resilience',
  outcomes: 'resilience',
  seed: 'resilience',
  seeds: 'resilience',
  chaos: 'resilience',
});

function roundHalfUp1(value) {
  return Math.round(value * 10) / 10;
}

function toPercent(part, total) {
  if (total === 0) return 100;
  return roundHalfUp1((part / total) * 100);
}

function isEligible(item) {
  return item.state !== COVERAGE_STATES.NOT_APPLICABLE;
}

function weightOf(item) {
  return CRITICALITY_WEIGHTS[item.criticality] || CRITICALITY_WEIGHTS.NORMAL;
}

/** Cobertura visitada: estados VISITED/VALIDATED/FAILED sobre elegíveis (0–100). */
function visitedCoverage(items) {
  const eligible = items.filter(isEligible);
  const visited = eligible.filter((item) => COUNTS_AS_VISITED.includes(item.state));
  return toPercent(visited.length, eligible.length);
}

/** Cobertura validada: apenas VALIDATED sobre elegíveis (0–100). */
function validatedCoverage(items) {
  const eligible = items.filter(isEligible);
  const validated = eligible.filter((item) => COUNTS_AS_VALIDATED.includes(item.state));
  return toPercent(validated.length, eligible.length);
}

/**
 * Taxa de sucesso de execuções: aprovadas / concluídas (0–100).
 * Concluídas = status 'passed' ou 'failed'; skipped/queued/outros são ignorados.
 */
function successRate(executions) {
  const concluded = executions.filter((e) => e.status === 'passed' || e.status === 'failed');
  const passed = concluded.filter((e) => e.status === 'passed');
  return toPercent(passed.length, concluded.length);
}

/**
 * Cobertura ponderada por criticidade (0–100):
 * Σ(peso × validado) / Σ(pesos elegíveis).
 */
function weightedCoverage(items) {
  const eligible = items.filter(isEligible);
  const totalWeight = eligible.reduce((sum, item) => sum + weightOf(item), 0);
  const validatedWeight = eligible
    .filter((item) => COUNTS_AS_VALIDATED.includes(item.state))
    .reduce((sum, item) => sum + weightOf(item), 0);
  return toPercent(validatedWeight, totalWeight);
}

/**
 * Cobertura por dimensão: { [dimension]: { total, eligible, visited, validated, weighted } }.
 */
function dimensionCoverage(items) {
  const byDimension = new Map();
  for (const item of items) {
    const dimension = item.dimension || 'unknown';
    if (!byDimension.has(dimension)) byDimension.set(dimension, []);
    byDimension.get(dimension).push(item);
  }
  const result = {};
  for (const [dimension, group] of byDimension.entries()) {
    result[dimension] = {
      total: group.length,
      eligible: group.filter(isEligible).length,
      visited: visitedCoverage(group),
      validated: validatedCoverage(group),
      weighted: weightedCoverage(group),
    };
  }
  return result;
}

/**
 * Resumo crítico: contagens de itens CRITICAL por estado problemático.
 * @returns {{uncovered:number, failed:number, stale:number, orphaned:number}}
 */
function criticalSummary(items) {
  const critical = items.filter((item) => item.criticality === 'CRITICAL');
  return {
    uncovered: critical.filter((i) => i.state === COVERAGE_STATES.UNCOVERED).length,
    failed: critical.filter((i) => i.state === COVERAGE_STATES.FAILED).length,
    stale: critical.filter((i) => i.state === COVERAGE_STATES.STALE).length,
    orphaned: critical.filter((i) => i.state === COVERAGE_STATES.ORPHANED).length,
  };
}

/**
 * Score consolidado de onda (0–100).
 *
 * @param {object} dimensions resultado de dimensionCoverage(items)
 * @param {object} [weights] pesos por grupo (default DEFAULT_WAVE_WEIGHTS).
 *   Aceita também o nome de um preset de WAVE_WEIGHT_PRESETS.
 *
 * Para cada grupo presente (com itens elegíveis), contribui
 * peso × cobertura validada do grupo; o score é normalizado pela soma dos
 * pesos dos grupos presentes. Sem nenhum grupo elegível, retorna 100.
 */
function waveScore(dimensions, weights = DEFAULT_WAVE_WEIGHTS) {
  const resolvedWeights = typeof weights === 'string'
    ? WAVE_WEIGHT_PRESETS[weights]
    : weights;
  if (!resolvedWeights) {
    throw new Error(`wave_weight_preset_unknown: ${weights}`);
  }

  let numerator = 0;
  let denominator = 0;
  for (const [group, weight] of Object.entries(resolvedWeights)) {
    const groupDimensions = Object.keys(DIMENSION_TO_WAVE_GROUP)
      .filter((d) => DIMENSION_TO_WAVE_GROUP[d] === group && dimensions[d]);
    const eligible = groupDimensions.reduce((sum, d) => sum + dimensions[d].eligible, 0);
    if (eligible === 0) continue;
    const validatedPercent = groupDimensions
      .reduce((sum, d) => sum + dimensions[d].validated * dimensions[d].eligible, 0) / eligible;
    numerator += weight * validatedPercent;
    denominator += weight;
  }
  if (denominator === 0) return 100;
  return roundHalfUp1(numerator / denominator);
}

module.exports = {
  DEFAULT_WAVE_WEIGHTS,
  WAVE_WEIGHT_PRESETS,
  DIMENSION_TO_WAVE_GROUP,
  visitedCoverage,
  validatedCoverage,
  successRate,
  weightedCoverage,
  dimensionCoverage,
  criticalSummary,
  waveScore,
};

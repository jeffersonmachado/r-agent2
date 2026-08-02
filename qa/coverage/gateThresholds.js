'use strict';

/**
 * Thresholds do Coverage Gate (release gate de cobertura).
 *
 * Defaults (DEFAULT_THRESHOLDS):
 * - criticalJourneysValidated: 100 (% de jornadas CRITICAL no estado VALIDATED)
 * - criticalOutcomesValidated: 100 (% de outcomes/cenários CRITICAL VALIDATED)
 * - criticalApiContractsValidated: 100 (% de APIs CRITICAL VALIDATED)
 * - uncoveredCriticalItems: 0 (itens CRITICAL nunca executados)
 * - failedCriticalItems: 0 (itens CRITICAL com falha)
 * - orphanedCriticalItems: 0 (itens CRITICAL sem vínculo no grafo)
 * - staleCriticalEvidence: 0 (evidências CRITICAL invalidadas por mudança)
 * - visibilityViolations: 0 (violações da política de visibilidade)
 * - tenantIsolationViolations: 0 (violações de isolamento de tenant)
 * - minimumJourneyCoverage: 85 (% validado das jornadas de negócio)
 * - minimumTechnicalCoverage: 80 (% validado de APIs/páginas/models)
 * - minimumWeightedCoverage: 85 (cobertura ponderada por criticidade)
 *
 * Sobrescrita (precedência: env > arquivo de config > defaults):
 * - Arquivo JSON (opcional): `config/coverage-gate-thresholds.json`, objeto
 *   plano com as mesmas chaves em camelCase.
 * - Variáveis de ambiente com prefixo COVERAGE_GATE_ em SCREAMING_SNAKE_CASE,
 *   ex.: COVERAGE_GATE_MINIMUM_JOURNEY_COVERAGE=90,
 *   COVERAGE_GATE_FAILED_CRITICAL_ITEMS=0.
 */

const fs = require('fs');

const DEFAULT_THRESHOLDS = Object.freeze({
  criticalJourneysValidated: 100,
  criticalOutcomesValidated: 100,
  criticalApiContractsValidated: 100,
  uncoveredCriticalItems: 0,
  failedCriticalItems: 0,
  orphanedCriticalItems: 0,
  staleCriticalEvidence: 0,
  visibilityViolations: 0,
  tenantIsolationViolations: 0,
  ragDomainSegregationViolations: 0,
  minimumJourneyCoverage: 85,
  minimumTechnicalCoverage: 80,
  minimumWeightedCoverage: 85,
});

const ENV_PREFIX = 'COVERAGE_GATE_';

function camelToScreamingSnake(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function parseThresholdValue(key, rawValue, source) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`coverage_gate_threshold_invalid: ${key} (${source}) = ${rawValue}`);
  }
  return value;
}

function applyOverrides(base, overrides, source) {
  const result = { ...base };
  for (const [key, rawValue] of Object.entries(overrides || {})) {
    if (key.startsWith('_')) continue; // comentários/documentação inline
    if (!(key in DEFAULT_THRESHOLDS)) {
      throw new Error(`coverage_gate_threshold_unknown: ${key} (${source})`);
    }
    result[key] = parseThresholdValue(key, rawValue, source);
  }
  return result;
}

function envOverrides(env = process.env) {
  const overrides = {};
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const envName = `${ENV_PREFIX}${camelToScreamingSnake(key)}`;
    if (env[envName] !== undefined && env[envName] !== '') {
      overrides[key] = env[envName];
    }
  }
  return overrides;
}

/**
 * Resolve os thresholds efetivos.
 *
 * @param {object} [options]
 * @param {string} [options.configPath] caminho de um JSON de overrides
 *   (ignorado quando inexistente).
 * @param {object} [options.env] mapa de ambiente (default process.env).
 * @returns {{thresholds: object, sources: {defaults: object, configFile: object, env: object}}}
 */
function resolveThresholds({ configPath, env = process.env } = {}) {
  let thresholds = { ...DEFAULT_THRESHOLDS };
  const configOverrides = {};

  if (configPath && fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    Object.assign(configOverrides, parsed);
    thresholds = applyOverrides(thresholds, configOverrides, configPath);
  }

  const envOv = envOverrides(env);
  thresholds = applyOverrides(thresholds, envOv, 'env');

  return {
    thresholds,
    sources: {
      defaults: { ...DEFAULT_THRESHOLDS },
      configFile: configOverrides,
      env: envOv,
    },
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  ENV_PREFIX,
  resolveThresholds,
};

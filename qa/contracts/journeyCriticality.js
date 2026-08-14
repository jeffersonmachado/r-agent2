'use strict';

/**
 * Journey Criticality — resolver do registry declarativo de criticidade de
 * jornadas (`config/journey-criticality.json`).
 *
 * Única fonte de verdade para "jornada bloqueante" (blocking) e severidade
 * por jornada, consumida tanto pela API (`api/services/qa/*`) quanto pelo
 * mesh (`qa-mesh/*`). Fail-closed: registry ausente ou inválido lança
 * `journey_criticality_registry_invalid` — um registry vazio silencioso
 * desbloquearia gates de release.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', '..', 'config', 'journey-criticality.json');
const VALID_CRITICALITIES = new Set(['blocking', 'high', 'medium', 'low']);

// Cache por (path, mtimeMs): o registry muda raramente e os consumidores
// resolvem em loops de validação.
const cache = new Map();

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  let stat;
  try {
    stat = fs.statSync(registryPath);
  } catch (_) {
    throw new Error(`journey_criticality_registry_invalid: arquivo ausente em ${registryPath}`);
  }

  const cached = cache.get(registryPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.registry;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`journey_criticality_registry_invalid: JSON inválido (${error.message})`);
  }

  const journeys = parsed && typeof parsed === 'object' ? parsed.journeys : null;
  if (!journeys || typeof journeys !== 'object' || Array.isArray(journeys)) {
    throw new Error('journey_criticality_registry_invalid: campo "journeys" ausente ou inválido');
  }

  const registry = new Map();
  for (const [rawId, entry] of Object.entries(journeys)) {
    const id = normalizeId(rawId);
    if (!id) continue;
    const criticality = String(entry?.criticality || '').trim().toLowerCase();
    if (!VALID_CRITICALITIES.has(criticality)) {
      throw new Error(`journey_criticality_registry_invalid: criticality inválida para "${id}"`);
    }
    registry.set(id, {
      criticality,
      severity: String(entry?.severity || '').trim().toLowerCase() || null,
    });
  }

  cache.set(registryPath, { mtimeMs: stat.mtimeMs, registry });
  return registry;
}

/**
 * IDs (normalizados) das jornadas com criticality 'blocking'.
 * @param {{ registryPath?: string }} [options]
 * @returns {string[]}
 */
function getBlockingJourneys(options = {}) {
  const registry = loadRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
  return Array.from(registry.entries())
    .filter(([, entry]) => entry.criticality === 'blocking')
    .map(([id]) => id);
}

/**
 * @param {string} journeyId - já normalizado ou não (o resolver normaliza)
 * @param {{ registryPath?: string }} [options]
 * @returns {boolean}
 */
function isBlockingJourney(journeyId, options = {}) {
  const id = normalizeId(journeyId);
  if (!id) return false;
  const registry = loadRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
  return registry.get(id)?.criticality === 'blocking';
}

/**
 * Mapa journeyId → severity declarada (apenas jornadas com severity).
 * @param {{ registryPath?: string }} [options]
 * @returns {Object<string, string>}
 */
function getSeverityByJourney(options = {}) {
  const registry = loadRegistry(options.registryPath || DEFAULT_REGISTRY_PATH);
  const result = {};
  for (const [id, entry] of registry.entries()) {
    if (entry.severity) result[id] = entry.severity;
  }
  return result;
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  getBlockingJourneys,
  isBlockingJourney,
  getSeverityByJourney,
  loadRegistry,
};

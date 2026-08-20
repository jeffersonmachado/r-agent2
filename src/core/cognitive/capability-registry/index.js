'use strict';

/**
 * Canonical Capability Registry — fonte canônica de capacidades de negócio.
 *
 * Modelo:
 *   Business Capability
 *     ├── tools          (ids canônicos do Cognitive Tool Registry)
 *     ├── permissions    (exigidas para usar a capability)
 *     ├── visibility     (PRODUCTION | SUPPORT | DEVELOPMENT)
 *     ├── intents        (intents de negócio cobertos)
 *     └── kind           (business | technical — técnicas claramente separadas)
 *
 * Nomes legados (ex.: appointment_booking, customer_lookup, agenda.book) são
 * resolvidos via tabela de aliases temporária. Nada aqui executa serviços:
 * execução é sempre via Tool Registry.
 *
 * Fonte de dados: config/canonical-capabilities.json (injetável em testes).
 */

const path = require('path');
const { canAccess, isValidVisibility } = require('../visibility');

const DEFAULT_DATA_PATH = path.join(__dirname, '..', '..', '..', '..', 'config', 'canonical-capabilities.json');

function loadData(dataPath) {
  // Require direto mantém cache do Node; testes injetam `data` explicitamente.
  // eslint-disable-next-line global-require
  return require(dataPath || DEFAULT_DATA_PATH);
}

function createCapabilityRegistry({ data, dataPath } = {}) {
  const raw = data || loadData(dataPath);

  const capabilities = new Map();
  const aliases = new Map();

  function assertCapability(id, def) {
    if (!id || typeof id !== 'string') throw new Error('capability_invalid: id is required');
    if (!def || typeof def !== 'object') throw new Error(`capability_invalid: definition required (${id})`);
    if (!isValidVisibility(def.visibility)) {
      throw new Error(`capability_invalid: visibility inválida (${id})`);
    }
    if (!Array.isArray(def.tools)) throw new Error(`capability_invalid: tools deve ser array (${id})`);
    if (!Array.isArray(def.permissions)) throw new Error(`capability_invalid: permissions deve ser array (${id})`);
  }

  for (const [id, def] of Object.entries(raw.capabilities || {})) {
    assertCapability(id, def);
    capabilities.set(id, Object.freeze({ id, kind: 'business', intents: [], ...def }));
  }
  for (const [id, def] of Object.entries(raw.technicalCapabilities || {})) {
    assertCapability(id, def);
    capabilities.set(id, Object.freeze({ id, kind: 'technical', intents: [], ...def }));
  }
  for (const [alias, canonical] of Object.entries(raw.aliases || {})) {
    if (!capabilities.has(canonical)) {
      throw new Error(`capability_invalid: alias '${alias}' aponta para capability inexistente '${canonical}'`);
    }
    if (capabilities.has(alias)) {
      throw new Error(`capability_invalid: alias '${alias}' colide com capability canônica`);
    }
    aliases.set(alias, canonical);
  }

  /** Resolve nome canônico ou alias legado → id canônico (ou null). */
  function resolveId(name) {
    if (!name) return null;
    const key = String(name).trim();
    if (capabilities.has(key)) return key;
    return aliases.get(key) || null;
  }

  /** Retorna o descriptor canônico (ou null). Aceita alias. */
  function get(name) {
    const id = resolveId(name);
    return id ? capabilities.get(id) : null;
  }

  function has(name) {
    return resolveId(name) !== null;
  }

  /**
   * Lista capabilities visíveis para a classificação do ator.
   * PRODUCTION nunca enxerga SUPPORT/DEVELOPMENT.
   */
  function list(actor = {}) {
    const classification = String(actor.classification || 'PRODUCTION').toUpperCase();
    return Array.from(capabilities.values())
      .filter((cap) => canAccess(classification, cap.visibility))
      .map((cap) => ({
        id: cap.id,
        name: cap.name,
        description: cap.description || null,
        domain: cap.domain,
        kind: cap.kind,
        visibility: cap.visibility,
        permissions: [...cap.permissions],
        tools: [...cap.tools],
        intents: [...(cap.intents || [])],
      }));
  }

  /** Capabilities canônicas que cobrem um intent de negócio. */
  function forIntent(intent) {
    const key = String(intent || '').trim();
    if (!key) return [];
    return Array.from(capabilities.values()).filter((cap) => (cap.intents || []).includes(key));
  }

  /** Ids de tools canônicas de uma capability (aceita alias). */
  function toolsFor(name) {
    const cap = get(name);
    return cap ? [...cap.tools] : [];
  }

  /** Normaliza uma lista de nomes (aliases ou canônicos) para ids canônicos únicos. */
  function normalize(names = []) {
    const out = new Set();
    for (const name of names) {
      const id = resolveId(name);
      if (id) out.add(id);
    }
    return [...out];
  }

  return {
    resolveId,
    get,
    has,
    list,
    forIntent,
    toolsFor,
    normalize,
    size: () => capabilities.size,
    aliases: () => new Map(aliases),
  };
}

let singleton = null;

/** Instância padrão sobre config/canonical-capabilities.json. */
function getCapabilityRegistry() {
  if (!singleton) singleton = createCapabilityRegistry();
  return singleton;
}

/** Apenas para testes. */
function resetCapabilityRegistry() {
  singleton = null;
}

module.exports = {
  createCapabilityRegistry,
  getCapabilityRegistry,
  resetCapabilityRegistry,
  DEFAULT_DATA_PATH,
};

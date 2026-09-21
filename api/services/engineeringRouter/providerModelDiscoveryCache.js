'use strict';

/**
 * api/services/engineeringRouter/providerModelDiscoveryCache.js
 *
 * Cache em memória (mesmo padrão de `modelAvailabilityStore.js`) do resultado de "quais
 * modelIds esta credencial pode realmente usar agora", consultado via
 * `aiCredentialValidation.listAvailableModelIds`. Achado real de um pilot com providers de IA
 * reais: um modelo mapeado em `modelCapabilities.js` (allowlist estática de segurança do
 * Engineering Router) pode não estar mais habilitado para a chave configurada — a V1 só
 * descobria isso de forma REATIVA (tentava e falhava). Este cache permite checar de forma
 * PROATIVA, sem consultar a API do provider a cada task roteada (TTL evita martelar o endpoint
 * de listagem a cada seleção).
 *
 * Fail-open por design: quando a consulta real falha ou nunca foi feita, `getKnownModelIds`
 * retorna `null` — o chamador (`engineeringModelAvailabilityService`) trata isso como "sem
 * informação, não filtra por esta camada", nunca como "nenhum modelo disponível". A allowlist
 * estática de `modelCapabilities.js` continua sendo a autoridade de segurança; este cache só
 * PODE remover um candidato dela, nunca adicionar um modelo não mapeado.
 */

const DEFAULT_TTL_MS = Number(process.env.ENGINEERING_ROUTER_MODEL_DISCOVERY_TTL_MS || 15 * 60 * 1000);

/** @type {Map<string, {modelIds: string[], checkedAt: number, expiresAt: number}>} */
const cache = new Map();

function key(providerId, tenantId) {
  return `${tenantId}:${providerId}`;
}

/**
 * @returns {string[]|null} lista de modelIds em cache, ou `null` se ausente/expirado (chamador
 *   decide se vale a pena consultar de novo — nunca consultado aqui, este módulo é só o cache).
 */
function getCached(providerId, tenantId) {
  const entry = cache.get(key(providerId, tenantId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key(providerId, tenantId));
    return null;
  }
  return entry.modelIds;
}

function setCached(providerId, tenantId, modelIds, ttlMs = DEFAULT_TTL_MS) {
  if (!providerId || !tenantId || !Array.isArray(modelIds)) return;
  const now = Date.now();
  cache.set(key(providerId, tenantId), { modelIds, checkedAt: now, expiresAt: now + ttlMs });
}

/**
 * Consulta real (com cache) — só chama a API do provider quando o cache está ausente/expirado.
 * Nunca lança: propaga `null` de `listAvailableModelIds` (fail-open) sem cachear falhas
 * (uma falha transitória de rede não deve "travar" o filtro fechado por 15 minutos).
 *
 * @returns {Promise<string[]|null>}
 */
async function resolveKnownModelIds(providerId, tenantId, apiKey) {
  const cached = getCached(providerId, tenantId);
  if (cached) return cached;

  // eslint-disable-next-line global-require
  const { listAvailableModelIds } = require('../aiCredentialValidation');
  const modelIds = await listAvailableModelIds(providerId, apiKey);
  if (modelIds === null) return null;
  setCached(providerId, tenantId, modelIds);
  return modelIds;
}

function _clearAllForTests() {
  cache.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  getCached,
  setCached,
  resolveKnownModelIds,
  _clearAllForTests,
};

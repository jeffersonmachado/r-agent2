'use strict';

/**
 * Principal — identidade explícita de quem/ o que inicia uma execução
 * cognitiva (humano, agente especialista, serviço interno ou anônimo
 * restrito).
 *
 * Regras absolutas:
 *  - Nenhuma execução recebe `permissions: ['*']` implicitamente.
 *  - Service principals com privilégio amplo só existem quando declarados
 *    explicitamente (configuração segura e auditável) — e mesmo assim o
 *    wildcard '*' é proibido nesta camada: liste as permissões.
 *  - Fail closed: sem identidade, o principal é restrito (sem permissões,
 *    classificação PRODUCTION — a mais baixa).
 */

const { VISIBILITY, isValidVisibility } = require('./visibility');

const PRINCIPAL_TYPES = Object.freeze(['user', 'agent', 'service', 'anonymous']);

function normalizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return permissions
    .map((p) => String(p || '').trim())
    .filter((p, i, arr) => p && arr.indexOf(p) === i);
}

/**
 * Constrói um principal normalizado. Nunca injeta wildcard.
 *
 * @param {object} args
 * @param {string} [args.principalId]    identificador único do principal
 * @param {string} [args.principalType]  user | agent | service | anonymous
 * @param {string} [args.tenantId]
 * @param {string} [args.userId]
 * @param {string} [args.agentId]
 * @param {string} [args.serviceId]
 * @param {string} [args.classification] PRODUCTION | SUPPORT | DEVELOPMENT
 * @param {string[]} [args.capabilities] capabilities canônicas autorizadas
 * @param {string[]} [args.permissions]  permissões de tools (sem '*' aqui)
 * @param {string} [args.channel]
 * @param {string} [args.sessionId]
 * @param {string} [args.correlationId]
 */
function buildPrincipal(args = {}) {
  const classification = String(args.classification || VISIBILITY.PRODUCTION).toUpperCase();
  const principalType = PRINCIPAL_TYPES.includes(args.principalType)
    ? args.principalType
    : (args.serviceId ? 'service' : args.agentId ? 'agent' : args.userId ? 'user' : 'anonymous');

  return {
    principalId: args.principalId || args.userId || args.agentId || args.serviceId || 'anonymous',
    principalType,
    tenantId: args.tenantId || null,
    userId: args.userId || null,
    agentId: args.agentId || null,
    serviceId: args.serviceId || null,
    classification: isValidVisibility(classification) ? classification : VISIBILITY.PRODUCTION,
    capabilities: Array.isArray(args.capabilities) ? [...args.capabilities] : [],
    permissions: normalizePermissions(args.permissions),
    channel: args.channel || null,
    sessionId: args.sessionId || null,
    correlationId: args.correlationId || null,
  };
}

/**
 * Principal padrão quando nenhum ator é informado: fail closed.
 * Sem permissões, classificação mais baixa — qualquer tool que exija
 * permissão é negada pelo Tool Registry.
 */
function defaultRestrictedPrincipal(overrides = {}) {
  return buildPrincipal({
    principalType: 'anonymous',
    classification: VISIBILITY.PRODUCTION,
    permissions: [],
    ...overrides,
  });
}

/**
 * Service principal declarado (ex.: entrada cognitiva de um canal).
 * Wildcard é proibido: privilégio amplo exige lista explícita e auditável.
 */
function buildServicePrincipal({ serviceId, tenantId, permissions = [], capabilities = [], classification = VISIBILITY.PRODUCTION, channel = null, sessionId = null, correlationId = null } = {}) {
  if (!serviceId) throw new Error('principal_service_id_required');
  const normalized = normalizePermissions(permissions);
  if (normalized.includes('*')) {
    throw new Error('principal_wildcard_forbidden: service principal deve declarar permissões explícitas');
  }
  return buildPrincipal({
    principalType: 'service',
    serviceId,
    principalId: serviceId,
    tenantId,
    classification,
    capabilities,
    permissions: normalized,
    channel,
    sessionId,
    correlationId,
  });
}

/**
 * Normaliza um "actor" legado ({ userId, classification, permissions }) para
 * o contrato de principal, sem nunca adicionar wildcard.
 */
function normalizeActor(actor, { tenantId = null, channel = null } = {}) {
  if (!actor || typeof actor !== 'object') {
    return defaultRestrictedPrincipal({ tenantId, channel });
  }
  return buildPrincipal({ ...actor, tenantId: actor.tenantId || tenantId, channel: actor.channel || channel });
}

module.exports = {
  PRINCIPAL_TYPES,
  buildPrincipal,
  buildServicePrincipal,
  defaultRestrictedPrincipal,
  normalizeActor,
};

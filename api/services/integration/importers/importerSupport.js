'use strict';

/**
 * Suporte comum aos importadores (provider → domínio canônico RAP).
 *
 * Concentra as regras de IDENTIDADE, que são as mais sensíveis da integração:
 *
 * 1. ID interno é do RAP. O id externo do provedor NUNCA é PK interna — ele
 *    vive em `IntegrationObjectLink`.
 * 2. ID interno derivado é determinístico (hash de tenant+provider+conexão+
 *    recurso+id externo), para que reimportação produza o MESMO id interno
 *    sem consultar o provedor.
 * 3. Chave de sincronização = (tenant, provider, connection, resource_type,
 *    external_id). Nunca CPF/e-mail/telefone/nome.
 * 4. Coincidência de pessoa (e-mail/telefone) só é usada como APOIO na PRIMEIRA
 *    vinculação, de forma determinística, e nunca funde duas identidades
 *    externas distintas — nesse caso registra CONFLITO para tratamento.
 */

const { sha256Hex, optionalString } = require('../integrationDb');
const { IntegrationError, INTEGRATION_ERROR_CODES, redactDeep } = require('../integrationRedaction');

/**
 * Id interno determinístico e não derivável do id externo isoladamente.
 * `resourceType` + `externalId` entram no hash junto com o escopo do tenant, o
 * que impede colisão entre tenants/conexões (mesmo external id em tenants
 * diferentes ⇒ ids internos diferentes).
 */
function deterministicInternalId({ tenantId, provider, connectionId, resourceType, externalId, prefix }) {
  const digest = sha256Hex([tenantId, provider, connectionId, resourceType, externalId].join('|')).slice(0, 32);
  return `${prefix}-${digest}`;
}

/** Contexto padrão de importação. */
function buildContext({
  tenantId, provider, connectionId, connection = null, stats = null,
}) {
  return {
    tenantId: String(tenantId),
    provider: String(provider),
    connectionId: String(connectionId),
    connection,
    stats,
    integrationMetadata: {
      provider: String(provider),
      connectionId: String(connectionId),
      externalUnitId: connection ? connection.external_unit_id || null : null,
    },
  };
}

/**
 * Resolve o id interno já vinculado, ou `null` quando é a primeira vinculação.
 */
async function findExistingLink({ linkService, ctx, resourceType, externalId }) {
  const link = await linkService.resolveInternal({
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    connectionId: ctx.connectionId,
    resourceType,
    externalId,
  });
  return link || null;
}

/** Persiste o vínculo external → interno (idempotente). */
async function persistLink({ linkService, ctx, resourceType, externalId, internalType, internalId, metadata = {} }) {
  const { link, created } = await linkService.linkExternal({
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    connectionId: ctx.connectionId,
    resourceType,
    externalId,
    internalType,
    internalId,
    metadata,
  });
  return { link, created };
}

/**
 * Registra um CONFLITO de identidade de forma auditável e determinística.
 * Não funde pessoas: o conflito vai para o metadata dos vínculos, para o
 * contador do lote e para o log sanitizado (tratável por suporte).
 */
function recordConflict({ stats, logger, ctx, reason, externalId, resourceType, candidates = [] }) {
  if (stats && stats.conflicts) stats.conflicts.push(redactDeep({ reason, resourceType, externalId, candidates }));
  if (logger && typeof logger.warn === 'function') {
    logger.warn('[Integration] conflito de identidade', redactDeep({
      reason,
      resourceType,
      externalId,
      candidateCount: candidates.length,
      tenantId: ctx.tenantId,
      provider: ctx.provider,
    }));
  }
}

function ensureInternalId({ ctx, resourceType, externalId, prefix }) {
  return deterministicInternalId({
    tenantId: ctx.tenantId,
    provider: ctx.provider,
    connectionId: ctx.connectionId,
    resourceType,
    externalId,
    prefix,
  });
}

/** Estatísticas de lote (todas persistidas em `integration_sync_states.stats`). */
function createStats() {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    conflicts: [],
    skipped: 0,
    pagesProcessed: 0,
  };
}

/** Normaliza e-mail/telefone para apoio de vinculação (nunca como chave). */
function supportIdentityFields({ email = null, phone = null }) {
  return {
    email: optionalString(email, 255) ? String(email).trim().toLowerCase() : null,
    phoneDigits: phone ? String(phone).replace(/\D/g, '') : null,
  };
}

function requireDependency(deps, key) {
  if (!deps || typeof deps[key] === 'undefined' || deps[key] === null) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, `importador sem dependência obrigatória: ${key}`, { key });
  }
  return deps[key];
}

module.exports = {
  deterministicInternalId,
  ensureInternalId,
  buildContext,
  findExistingLink,
  persistLink,
  recordConflict,
  createStats,
  supportIdentityFields,
  requireDependency,
};

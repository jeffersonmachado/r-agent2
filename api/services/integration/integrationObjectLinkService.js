'use strict';

/**
 * IntegrationObjectLinkService — mapeamento determinístico external_id ↔
 * recurso interno canônico do RAP.
 *
 * Invariante: o id externo NUNCA é PK interna. A chave é
 * (tenant_key, provider, connection_id, resource_type, external_id), o que
 * torna o mesmo external id de tenants diferentes duas identidades distintas e
 * o mesmo objeto reimportado N vezes sempre UMA linha.
 */

const { getSequelize } = require('../../db/sequelize');
const { IntegrationObjectLink } = require('../../db/models');
const { Op } = require('sequelize');
const { IntegrationError, INTEGRATION_ERROR_CODES } = require('./integrationRedaction');
const { makeId, dbAvailable, isUniqueViolation, optionalString } = require('./integrationDb');

function requireDb() {
  if (!dbAvailable()) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.DB_UNAVAILABLE, 'banco indisponível para integração');
  }
}

function normalizeScope({ tenantId, provider, connectionId, resourceType, externalId }) {
  const scope = {
    tenant_key: optionalString(tenantId, 255),
    provider: optionalString(provider, 64),
    connection_id: optionalString(connectionId, 255),
    resource_type: optionalString(resourceType, 64),
    external_id: optionalString(externalId, 255),
  };
  for (const [key, value] of Object.entries(scope)) {
    if (!value) {
      throw new IntegrationError(
        INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION,
        `escopo de link incompleto: ${key}`,
        { key },
      );
    }
  }
  return scope;
}

/**
 * Cria ou atualiza o link. Idempotente: repetir com o mesmo escopo devolve a
 * MESMA linha (nunca duplica), inclusive sob corrida (23505 → re-fetch).
 *
 * @returns {Promise<{ link: object, created: boolean }>}
 */
async function linkExternal({
  tenantId,
  provider,
  connectionId,
  resourceType,
  externalId,
  internalType,
  internalId,
  metadata = {},
  seenAt = new Date(),
} = {}) {
  requireDb();
  const scope = normalizeScope({ tenantId, provider, connectionId, resourceType, externalId });
  const internal = {
    internal_type: optionalString(internalType, 64),
    internal_id: optionalString(internalId, 255),
  };
  if (!internal.internal_type || !internal.internal_id) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION,
      'link externo exige internalType e internalId',
      { resourceType },
    );
  }

  const Model = IntegrationObjectLink();
  const existing = await Model.findOne({ where: scope });
  if (existing) {
    const changed = existing.internal_type !== internal.internal_type || existing.internal_id !== internal.internal_id;
    await existing.update({
      internal_type: internal.internal_type,
      internal_id: internal.internal_id,
      last_seen_at: seenAt,
      sync_version: changed ? Number(existing.sync_version || 1) + 1 : Number(existing.sync_version || 1),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
    return { link: existing.toJSON ? existing.toJSON() : existing, created: false };
  }

  try {
    const row = await Model.create({
      id: makeId('ilink'),
      ...scope,
      internal_type: internal.internal_type,
      internal_id: internal.internal_id,
      sync_version: 1,
      last_seen_at: seenAt,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
    return { link: row.toJSON ? row.toJSON() : row, created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await Model.findOne({ where: scope });
      if (raced) return { link: raced.toJSON ? raced.toJSON() : raced, created: false };
    }
    throw error;
  }
}

/** Resolve o recurso interno a partir do objeto externo. */
async function resolveInternal(params = {}) {
  if (!dbAvailable()) return null;
  const scope = normalizeScope(params);
  const row = await IntegrationObjectLink().findOne({ where: scope });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

/** Resolve o link a partir do recurso interno (direção inversa). */
async function resolveExternal({
  tenantId, provider = null, connectionId = null, resourceType = null, internalType, internalId,
} = {}) {
  if (!dbAvailable()) return null;
  const where = {
    tenant_key: optionalString(tenantId, 255),
    internal_type: optionalString(internalType, 64),
    internal_id: optionalString(internalId, 255),
  };
  if (!where.tenant_key || !where.internal_type || !where.internal_id) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'resolveExternal exige tenantId, internalType e internalId');
  }
  if (provider) where.provider = optionalString(provider, 64);
  if (connectionId) where.connection_id = optionalString(connectionId, 255);
  if (resourceType) where.resource_type = optionalString(resourceType, 64);
  const row = await IntegrationObjectLink().findOne({ where });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

/**
 * Resolve VÁRIOS external ids em uma ÚNICA query (evita N+1 em sync de lote).
 *
 * @param {object} params
 * @param {string[]} params.externalIds
 * @returns {Promise<Map<string, object>>} external_id → link
 */
async function bulkResolveInternal({
  tenantId, provider, connectionId, resourceType, externalIds = [],
} = {}) {
  const map = new Map();
  if (!dbAvailable() || externalIds.length === 0) return map;
  const ids = [...new Set(externalIds.map((id) => String(id)))];
  const rows = await IntegrationObjectLink().findAll({
    where: {
      tenant_key: String(tenantId),
      provider: String(provider),
      connection_id: String(connectionId),
      resource_type: String(resourceType),
      external_id: { [Op.in]: ids },
    },
  });
  for (const row of rows) {
    const plain = row.toJSON ? row.toJSON() : row;
    map.set(String(plain.external_id), plain);
  }
  return map;
}

async function listLinks({ tenantId, provider = null, resourceType = null, limit = 200 } = {}) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const where = { tenant_key: String(tenantId) };
  if (provider) where.provider = String(provider);
  if (resourceType) where.resource_type = String(resourceType);
  const rows = await IntegrationObjectLink().findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 200, 1000),
  });
  const items = rows.map((row) => (row.toJSON ? row.toJSON() : row));
  return { items, total: items.length };
}

async function countLinks({ tenantId, provider = null, resourceType = null } = {}) {
  if (!dbAvailable()) return 0;
  const where = { tenant_key: String(tenantId) };
  if (provider) where.provider = String(provider);
  if (resourceType) where.resource_type = String(resourceType);
  return IntegrationObjectLink().count({ where });
}

module.exports = {
  linkExternal,
  resolveInternal,
  resolveExternal,
  bulkResolveInternal,
  listLinks,
  countLinks,
};

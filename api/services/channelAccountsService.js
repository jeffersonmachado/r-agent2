/**
 * Channel Accounts Service (DB-first)
 *
 * CRUD de channel_accounts com config criptografado.
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelAccount: ChannelAccountGetter } = require('../db/models');
const { encrypt, decrypt } = require('../utils/crypto');
const { checkLimit } = require('./planLimitsService');

function dbAvailable() {
  return !!getSequelize();
}

function model() {
  return typeof ChannelAccountGetter === 'function' ? ChannelAccountGetter() : ChannelAccountGetter;
}

function newId(prefix = 'acct') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function decryptConfig(configEncrypted) {
  if (!configEncrypted) return null;
  try {
    return JSON.parse(decrypt(configEncrypted));
  } catch (e) {
    return null;
  }
}

function encryptConfig(configObj) {
  if (configObj === null || configObj === undefined) return null;
  return encrypt(JSON.stringify(configObj));
}

function fromDbRow(row, { includeConfig = false } = {}) {
  const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
  return {
    id: base.id,
    tenantId: base.tenant_key,
    type: base.type,
    status: base.status,
    externalId: base.external_id || null,
    ...(includeConfig ? { config: decryptConfig(base.config_encrypted) } : {}),
    createdAt: base.created_at ? new Date(base.created_at).toISOString() : (base.createdAt?.toISOString?.() || null),
    updatedAt: base.updated_at ? new Date(base.updated_at).toISOString() : (base.updatedAt?.toISOString?.() || null),
  };
}

async function listAccounts({ tenantId, includeConfig = false } = {}) {
  if (!tenantId) return [];
  if (!dbAvailable()) return [];
  const Model = model();
  const rows = await Model.findAll({ where: { tenant_key: tenantId }, order: [['created_at', 'DESC']] });
  return rows.map(r => fromDbRow(r, { includeConfig }));
}

async function getAccount({ tenantId, id, includeConfig = false } = {}) {
  if (!tenantId || !id) return null;
  if (!dbAvailable()) return null;
  const Model = model();
  const row = await Model.findOne({ where: { id, tenant_key: tenantId } });
  if (!row) return null;
  return fromDbRow(row, { includeConfig });
}

async function createAccount({ tenantId, type, externalId = null, status = 'active', config = null } = {}) {
  if (!tenantId) return { success: false, error: 'tenantId é obrigatório' };
  if (!type) return { success: false, error: 'type é obrigatório' };

  if (!dbAvailable()) return { success: false, error: 'db_unavailable' };

  // Plan limits: max_canais
  try {
    const limitCheck = await checkLimit(tenantId, 'max_canais', 1);
    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.error || 'Limite de canais excedido' };
    }
  } catch (e) {
    logger.warn('[ChannelAccounts] Falha ao checar limite de canais (ignorado)', { tenantId, error: e.message });
  }

  const Model = model();
  const now = new Date();
  const id = newId('acct');

  const payload = {
    id,
    tenant_key: tenantId,
    type: String(type),
    status: status || 'active',
    external_id: externalId ? String(externalId) : null,
    config_encrypted: config ? encryptConfig(config) : null,
    created_at: now,
    updated_at: now,
  };

  await Model.create(payload);
  return { success: true, account: { id, tenantId, type: payload.type, status: payload.status, externalId: payload.external_id } };
}

async function updateAccount({ tenantId, id, patch = {} } = {}) {
  if (!tenantId || !id) return { success: false, error: 'tenantId e id são obrigatórios' };
  if (!dbAvailable()) return { success: false, error: 'db_unavailable' };
  const Model = model();
  const row = await Model.findOne({ where: { id, tenant_key: tenantId } });
  if (!row) return { success: false, error: 'not_found' };

  const updates = {};
  if (patch.type) updates.type = String(patch.type);
  if (patch.status) updates.status = String(patch.status);
  if (patch.externalId !== undefined) updates.external_id = patch.externalId ? String(patch.externalId) : null;
  if (patch.config !== undefined) updates.config_encrypted = patch.config ? encryptConfig(patch.config) : null;
  updates.updated_at = new Date();

  await row.update(updates);
  return { success: true, account: fromDbRow(row, { includeConfig: false }) };
}

async function deleteAccount({ tenantId, id } = {}) {
  if (!tenantId || !id) return { success: false, error: 'tenantId e id são obrigatórios' };
  if (!dbAvailable()) return { success: false, error: 'db_unavailable' };
  const Model = model();
  const deleted = await Model.destroy({ where: { id, tenant_key: tenantId } });
  if (!deleted) return { success: false, error: 'not_found' };
  return { success: true, deletedId: id };
}

module.exports = {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
};


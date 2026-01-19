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
const https = require('https');

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

function getAny(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return undefined;
}

function validateConfigForType(type, { externalId, config } = {}) {
  const t = String(type || '').toLowerCase();
  const cfg = config && typeof config === 'object' ? config : null;
  const missing = [];

  if (t === 'webchat' || t === '') {
    return { ok: true, missing: [] };
  }

  if (t === 'whatsapp') {
    const token = getAny(cfg, ['accessToken', 'token', 'whatsappAccessToken', 'pageAccessToken']);
    const phoneNumberId = externalId || getAny(cfg, ['phone_number_id', 'phoneNumberId', 'phone_numberId']);
    if (!token) missing.push('token/accessToken');
    if (!phoneNumberId) missing.push('externalId (phone_number_id)');
    return { ok: missing.length === 0, missing };
  }

  if (t === 'instagram') {
    const token = getAny(cfg, ['pageAccessToken', 'accessToken', 'token']);
    const pageId = externalId || getAny(cfg, ['pageId', 'page_id']);
    if (!token) missing.push('pageAccessToken/accessToken');
    if (!pageId) missing.push('externalId (pageId)');
    return { ok: missing.length === 0, missing };
  }

  // desconhecido: não bloqueia, mas sinaliza sem requisitos
  return { ok: true, missing: [] };
}

function httpGetJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method: 'GET',
      hostname: u.hostname,
      path: `${u.pathname}${u.search || ''}`,
      headers,
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        const isJson = String(contentType).includes('application/json');
        const parsed = isJson ? (JSON.parse(data || '{}') || {}) : null;
        resolve({ statusCode: res.statusCode, data: parsed, raw: data });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testAccountConnection({ tenantId, id, timeoutMs = 8000 } = {}) {
  if (!tenantId || !id) return { success: false, error: 'tenantId e id são obrigatórios' };
  const account = await getAccount({ tenantId, id, includeConfig: true });
  if (!account) return { success: false, error: 'not_found' };

  const cfg = account.config && typeof account.config === 'object' ? account.config : null;
  const validation = validateConfigForType(account.type, { externalId: account.externalId, config: cfg });
  if (!validation.ok) {
    return { success: false, error: 'missing_config', missing: validation.missing };
  }

  const t = String(account.type || '').toLowerCase();
  if (t === 'webchat') {
    return { success: true, details: { type: 'webchat', ok: true, note: 'webchat não requer teste externo' } };
  }

  if (t === 'whatsapp') {
    const apiUrl = String(getAny(cfg, ['apiUrl', 'api_url']) || 'https://graph.facebook.com/v18.0');
    const token = String(getAny(cfg, ['accessToken', 'token', 'whatsappAccessToken', 'pageAccessToken']));
    const phoneNumberId = String(account.externalId || getAny(cfg, ['phone_number_id', 'phoneNumberId', 'phone_numberId']));
    const url = `${apiUrl.replace(/\/$/, '')}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
    const resp = await httpGetJson(url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs });
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return { success: true, details: { type: 'whatsapp', ok: true, phoneNumberId, profile: resp.data } };
    }
    return {
      success: false,
      error: 'upstream_error',
      statusCode: resp.statusCode,
      message: resp?.data?.error?.message || `WhatsApp Graph API error: ${resp.statusCode}`,
      details: resp.data || null,
    };
  }

  if (t === 'instagram') {
    const apiUrl = String(getAny(cfg, ['apiUrl', 'api_url']) || 'https://graph.facebook.com/v18.0');
    const token = String(getAny(cfg, ['pageAccessToken', 'accessToken', 'token']));
    const pageId = String(account.externalId || getAny(cfg, ['pageId', 'page_id']));
    const url = `${apiUrl.replace(/\/$/, '')}/${encodeURIComponent(pageId)}?fields=name,instagram_business_account`;
    const resp = await httpGetJson(url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs });
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return { success: true, details: { type: 'instagram', ok: true, pageId, page: resp.data } };
    }
    return {
      success: false,
      error: 'upstream_error',
      statusCode: resp.statusCode,
      message: resp?.data?.error?.message || `Instagram Graph API error: ${resp.statusCode}`,
      details: resp.data || null,
    };
  }

  return { success: true, details: { type: account.type, ok: true, note: 'tipo não possui teste específico' } };
}

module.exports = {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  testAccountConnection,
  _internal: {
    validateConfigForType,
  },
};


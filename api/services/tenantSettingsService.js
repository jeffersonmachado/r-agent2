/**
 * Tenant settings (v1).
 *
 * Usa a tabela tenant_settings para armazenar configs dinâmicas
 * (ex.: sso, scim, features).
 */
'use strict';

const { TenantSetting } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) return safeToString(message, fallback);
  return safeToString(err, fallback);
}

function isUuid(value) {
  const v = safeToString(value, '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function resolveTenantUuid(tenantId) {
  const tenantRaw = safeToString(tenantId, '').trim();
  if (!tenantRaw) return null;
  if (isUuid(tenantRaw)) return tenantRaw;

  try {
    // Lazy import para manter compatibilidade com testes que mockam apenas TenantSetting.
    // eslint-disable-next-line global-require
    const models = require('../db/models');
    const tenantFactory = models.Tenant || models.getTenant;
    if (typeof tenantFactory !== 'function') return tenantRaw;

    const TenantModel = tenantFactory();
    const row = await TenantModel.findOne({ where: { tenant_key: tenantRaw }, attributes: ['id'] });
    if (!row) return null;

    const json = row.toJSON ? row.toJSON() : row;
    return safeToString((json && json.id) || row.id || null, null);
  } catch (err) {
    logger.warn('[tenantSettingsService] Falha ao resolver tenant UUID por tenant_key', {
      tenantId: tenantRaw,
      error: safeErrorMessage(err),
    });
    return null;
  }
}

function dbAvailable() {
  const seq = getSequelize();
  if (!seq) {
    logger.warn('[tenantSettingsService] Sequelize not available yet (getSequelize returned null)');
  }
  return !!seq;
}

async function getSetting({ tenantId, key }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const tenantUuid = await resolveTenantUuid(tenantId);
    if (!tenantUuid) return { ok: false, error: 'tenant_not_found' };

    const Model = TenantSetting();
    const row = await Model.findOne({ where: { tenant_id: tenantUuid, key: safeToString(key) } });
    if (!row) return { ok: true, value: null };
    const json = row.toJSON ? row.toJSON() : row;
    return { ok: true, value: json.value || null };
  } catch (err) {
    // Fallback: tabela ausente em ambientes sem migrations
    if (err && err.code === '42P01') {
      return { ok: true, value: null, warning: 'table_missing' };
    }
    return { ok: false, error: 'db_error', details: safeErrorMessage(err) };
  }
}

async function upsertSetting({ tenantId, key, value }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const tenantUuid = await resolveTenantUuid(tenantId);
    if (!tenantUuid) return { ok: false, error: 'tenant_not_found' };

    const Model = TenantSetting();
    const existing = await Model.findOne({ where: { tenant_id: tenantUuid, key: safeToString(key) } });
    const nextValue = value && typeof value === 'object' ? value : {};
    const row = existing
      ? await existing.update({ value: nextValue })
      : await Model.create({ tenant_id: tenantUuid, key: safeToString(key), value: nextValue });
    const json = row.toJSON ? row.toJSON() : row;
    return { ok: true, value: json.value || null };
  } catch (err) {
    if (err && err.code === '42P01') {
      return { ok: false, error: 'table_missing' };
    }
    return { ok: false, error: 'db_error', details: safeErrorMessage(err) };
  }
}

module.exports = {
  getSetting,
  upsertSetting,
  resolveTenantUuid,
};

/**
 * Tenant settings (v1).
 *
 * Usa a tabela tenant_settings para armazenar configs dinâmicas
 * (ex.: sso, scim, features).
 */
'use strict';

const { TenantSetting } = require('../db/models');
const { getSequelize } = require('../db/sequelize');

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

function dbAvailable() {
  return !!getSequelize();
}

async function getSetting({ tenantId, key }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const Model = TenantSetting();
    const row = await Model.findOne({ where: { tenant_id: safeToString(tenantId), key: safeToString(key) } });
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
    const Model = TenantSetting();
    const existing = await Model.findOne({ where: { tenant_id: safeToString(tenantId), key: safeToString(key) } });
    const nextValue = value && typeof value === 'object' ? value : {};
    const row = existing
      ? await existing.update({ value: nextValue })
      : await Model.create({ tenant_id: safeToString(tenantId), key: safeToString(key), value: nextValue });
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
};

/**
 * Tenant settings (v1).
 *
 * Usa a tabela tenant_settings para armazenar configs dinâmicas
 * (ex.: sso, scim, features).
 */
'use strict';

const { TenantSetting } = require('../db/models');
const { getSequelize } = require('../db/sequelize');

function dbAvailable() {
  return !!getSequelize();
}

async function getSetting({ tenantId, key }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const Model = TenantSetting();
    const row = await Model.findOne({ where: { tenant_id: String(tenantId), key: String(key) } });
    if (!row) return { ok: true, value: null };
    const json = row.toJSON ? row.toJSON() : row;
    return { ok: true, value: json.value || null };
  } catch (err) {
    // Fallback: tabela ausente em ambientes sem migrations
    if (err && err.code === '42P01') {
      return { ok: true, value: null, warning: 'table_missing' };
    }
    return { ok: false, error: 'db_error', details: err.message };
  }
}

async function upsertSetting({ tenantId, key, value }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const Model = TenantSetting();
    const existing = await Model.findOne({ where: { tenant_id: String(tenantId), key: String(key) } });
    const nextValue = value && typeof value === 'object' ? value : {};
    const row = existing
      ? await existing.update({ value: nextValue })
      : await Model.create({ tenant_id: String(tenantId), key: String(key), value: nextValue });
    const json = row.toJSON ? row.toJSON() : row;
    return { ok: true, value: json.value || null };
  } catch (err) {
    if (err && err.code === '42P01') {
      return { ok: false, error: 'table_missing' };
    }
    return { ok: false, error: 'db_error', details: err.message };
  }
}

module.exports = {
  getSetting,
  upsertSetting,
};

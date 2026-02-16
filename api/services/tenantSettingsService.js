/**
 * Tenant settings (v1).
 *
 * Usa a tabela tenant_settings para armazenar configs dinâmicas
 * (ex.: sso, scim, features).
 */
'use strict';

const { Tenant, TenantSetting } = require('../db/models');
const { getSequelize } = require('../db/sequelize');

function dbAvailable() {
  return !!getSequelize();
}

function isUuid(v) {
  const s = String(v || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function resolveTenantId(tenantIdOrKey) {
  const raw = String(tenantIdOrKey || '').trim();
  if (!raw) return null;
  if (isUuid(raw)) return raw;
  // Backward-compat: some call sites pass tenant_key (ex: "system") instead of UUID.
  try {
    const Model = Tenant();
    const row = await Model.findOne({ where: { tenant_key: raw } });
    if (!row) return null;
    const json = row.toJSON ? row.toJSON() : row;
    return json.id || null;
  } catch (err) {
    // If tenants table is missing in some environments, treat as unresolved.
    if (err && err.code === '42P01') return null;
    return null;
  }
}

async function getSetting({ tenantId, key }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!tenantId || !key) return { ok: false, error: 'invalid_args' };
  try {
    const resolvedTenantId = await resolveTenantId(tenantId);
    if (!resolvedTenantId) return { ok: true, value: null };
    const Model = TenantSetting();
    const row = await Model.findOne({ where: { tenant_id: String(resolvedTenantId), key: String(key) } });
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
    const resolvedTenantId = await resolveTenantId(tenantId);
    if (!resolvedTenantId) return { ok: false, error: 'invalid_tenant' };
    const Model = TenantSetting();
    const existing = await Model.findOne({ where: { tenant_id: String(resolvedTenantId), key: String(key) } });
    const nextValue = value && typeof value === 'object' ? value : {};
    const row = existing
      ? await existing.update({ value: nextValue })
      : await Model.create({ tenant_id: String(resolvedTenantId), key: String(key), value: nextValue });
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

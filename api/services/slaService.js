/**
 * SLA policies (v1) - MVP.
 *
 * Armazena políticas e breaches em tenant_settings.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'sla_policies';

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    policies: Array.isArray(obj.policies) ? obj.policies : [],
    breaches: Array.isArray(obj.breaches) ? obj.breaches : [],
  };
}

function normalizePolicy(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    name: item.name ? String(item.name) : '',
    description: item.description ? String(item.description) : '',
    customerSegment: item.customerSegment ? String(item.customerSegment) : 'default',
    responseTimeMin: Number.isFinite(item.responseTimeMin) ? Number(item.responseTimeMin) : null,
    resolutionTimeMin: Number.isFinite(item.resolutionTimeMin) ? Number(item.resolutionTimeMin) : null,
    enabled: item.enabled !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

async function getStore(tenantId) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function saveStore(tenantId, store) {
  const payload = normalizeStore(store);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: payload });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function listPolicies(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const items = out.store.policies.map(normalizePolicy).filter(Boolean);
  return { ok: true, policies: items };
}

async function upsertPolicy(tenantId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date().toISOString();
  const id = input?.id ? String(input.id) : `sla-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizePolicy({
    id,
    name: input?.name ? String(input.name).trim() : '',
    description: input?.description ? String(input.description).trim() : '',
    customerSegment: input?.customerSegment ? String(input.customerSegment).trim() : 'default',
    responseTimeMin: input?.responseTimeMin != null ? Number(input.responseTimeMin) : null,
    resolutionTimeMin: input?.resolutionTimeMin != null ? Number(input.resolutionTimeMin) : null,
    enabled: input?.enabled !== false,
    updatedAt: now,
  });

  const idx = out.store.policies.findIndex((p) => p && p.id === id);
  if (idx >= 0) {
    const prev = normalizePolicy(out.store.policies[idx]);
    out.store.policies[idx] = { ...prev, ...next, createdAt: prev?.createdAt || now };
  } else {
    out.store.policies.push({ ...next, createdAt: now });
  }

  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, policy: next };
}

async function listBreaches(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const breaches = Array.isArray(out.store.breaches) ? out.store.breaches : [];
  return { ok: true, breaches };
}

module.exports = {
  listPolicies,
  upsertPolicy,
  listBreaches,
};

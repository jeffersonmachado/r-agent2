/**
 * Automations (v1) - low-code.
 *
 * Armazena definições de automação em tenant_settings para MVP.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'automations';

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    automations: Array.isArray(obj.automations) ? obj.automations : [],
  };
}

function normalizeAutomation(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: safeToString(item.id || ''),
    name: item.name ? safeToString(item.name) : '',
    description: item.description ? safeToString(item.description) : '',
    status: item.status ? safeToString(item.status) : 'draft',
    definition: item.definition && typeof item.definition === 'object' ? item.definition : {},
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    publishedAt: item.publishedAt || null,
    lastRunAt: item.lastRunAt || null,
    lastRunId: item.lastRunId || null,
    lastRunStatus: item.lastRunStatus || null,
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

async function listAutomations(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const items = out.store.automations.map(normalizeAutomation).filter(Boolean);
  return { ok: true, automations: items };
}

async function upsertAutomation(tenantId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date().toISOString();
  const id = input?.id ? safeToString(input.id) : `auto-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeAutomation({
    id,
    name: input?.name ? safeTrim(input.name) : '',
    description: input?.description ? safeTrim(input.description) : '',
    status: input?.status ? safeToString(input.status) : 'draft',
    definition: input?.definition && typeof input.definition === 'object' ? input.definition : {},
    updatedAt: now,
  });

  const idx = out.store.automations.findIndex((a) => a && a.id === id);
  if (idx >= 0) {
    const prev = normalizeAutomation(out.store.automations[idx]);
    out.store.automations[idx] = {
      ...prev,
      ...next,
      createdAt: prev?.createdAt || now,
    };
  } else {
    out.store.automations.push({ ...next, createdAt: now });
  }

  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, automation: next, automations: saved.store.automations.map(normalizeAutomation).filter(Boolean) };
}

async function publishAutomation(tenantId, automationId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.automations.findIndex((a) => a && safeToString(a.id) === safeToString(automationId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const next = normalizeAutomation({
    ...out.store.automations[idx],
    status: 'published',
    updatedAt: now,
    publishedAt: now,
  });
  out.store.automations[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, automation: next };
}

async function runAutomation(tenantId, automationId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.automations.findIndex((a) => a && safeToString(a.id) === safeToString(automationId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeAutomation({
    ...out.store.automations[idx],
    lastRunAt: now,
    lastRunId: runId,
    lastRunStatus: 'queued',
    updatedAt: now,
  });
  out.store.automations[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, automation: next, run: { id: runId, status: 'queued', queuedAt: now } };
}

module.exports = {
  listAutomations,
  upsertAutomation,
  publishAutomation,
  runAutomation,
};

'use strict';

const crypto = require('crypto');
const signalStateStoreV2 = require('../operational-state/OperationalSignalStateStoreV2');

const ACTIVE_STATUSES = new Set(['open', 'acknowledged']);
const ALL_STATUSES = new Set(['open', 'acknowledged', 'resolved', 'expired']);
const ALL_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function nowIso() {
  return new Date().toISOString();
}

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPositiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createSignalId() {
  return `opsig-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeStatus(value, fallback = 'open') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ALL_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeSeverity(value, fallback = 'medium') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ALL_SEVERITIES.has(normalized) ? normalized : fallback;
}

function severityRank(value) {
  const map = { low: 1, medium: 2, high: 3, critical: 4 };
  return map[normalizeSeverity(value)] || 2;
}

function normalizeSignal(input, tenantId) {
  const detectedAt = input?.detectedAt || input?.detected_at || nowIso();
  const status = normalizeStatus(input?.status, 'open');
  const resolvedAtRaw = input?.resolvedAt || input?.resolved_at || null;
  return {
    id: safeStr(input?.id) || createSignalId(),
    tenant_id: safeStr(input?.tenantId || input?.tenant_id) || safeStr(tenantId),
    contact_id: safeStr(input?.contactId || input?.contact_id),
    type: safeStr(input?.type) || 'channel_attention',
    status,
    severity: normalizeSeverity(input?.severity, 'medium'),
    confidence: Math.max(0, Math.min(1, toPositiveNumber(input?.confidence, 0.5))),
    source_module: safeStr(input?.sourceModule || input?.source_module) || 'operational_agent',
    context_json: safeObject(input?.context || input?.context_json),
    detected_at: new Date(detectedAt).toISOString(),
    resolved_at: status === 'resolved' || status === 'expired'
      ? (resolvedAtRaw ? new Date(resolvedAtRaw).toISOString() : nowIso())
      : null,
    created_at: input?.created_at ? new Date(input.created_at).toISOString() : nowIso(),
    updated_at: nowIso(),
  };
}

function normalizeStore(value) {
  const base = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(base.signals) ? base.signals : [];
  return {
    signals: items
      .map((item) => {
        try {
          return normalizeSignal(item, item?.tenant_id || item?.tenantId);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean),
  };
}

function isEquivalentWithinWindow(existing, incoming, dedupWindowMinutes) {
  if (!existing || !incoming) return false;
  if (safeStr(existing.tenant_id) !== safeStr(incoming.tenant_id)) return false;
  if (safeStr(existing.type) !== safeStr(incoming.type)) return false;
  if (safeStr(existing.contact_id) !== safeStr(incoming.contact_id)) return false;
  if (!ACTIVE_STATUSES.has(normalizeStatus(existing.status))) return false;

  const windowMs = Math.max(1, Number(dedupWindowMinutes) || 240) * 60 * 1000;
  const existingTs = Date.parse(existing.detected_at || existing.updated_at || existing.created_at || 0);
  if (!Number.isFinite(existingTs)) return false;
  return (Date.now() - existingTs) <= windowMs;
}

function mergeEquivalentSignal(existing, incoming) {
  const mergedSeverity = severityRank(incoming.severity) > severityRank(existing.severity)
    ? normalizeSeverity(incoming.severity)
    : normalizeSeverity(existing.severity);

  return {
    ...existing,
    status: 'open',
    severity: mergedSeverity,
    confidence: Math.max(toPositiveNumber(existing.confidence, 0), toPositiveNumber(incoming.confidence, 0)),
    source_module: safeStr(incoming.source_module) || safeStr(existing.source_module) || 'operational_agent',
    context_json: {
      ...safeObject(existing.context_json),
      ...safeObject(incoming.context_json),
      mergedAt: nowIso(),
    },
    detected_at: incoming.detected_at || existing.detected_at || nowIso(),
    resolved_at: null,
    updated_at: nowIso(),
  };
}

function normalizeStatuses(statuses) {
  if (!Array.isArray(statuses)) {
    const single = safeStr(statuses);
    return single ? [normalizeStatus(single, 'open')] : null;
  }
  return statuses
    .map((item) => normalizeStatus(item, null))
    .filter(Boolean);
}

async function upsertDetectedSignals({ tenantId, signals = [], dedupWindowMinutes = 240 }) {
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const activeSignalsOut = await signalStateStoreV2.listSignals({
    tenantId: tenantKey,
    activeOnly: true,
    limit: 1000,
  });
  if (!activeSignalsOut?.ok) {
    return { ok: false, error: activeSignalsOut?.error || 'signals_unavailable' };
  }

  const activeSignals = (Array.isArray(activeSignalsOut.items) ? activeSignalsOut.items : [])
    .map((item) => normalizeSignal(item, tenantKey))
    .filter((item) => item.tenant_id === tenantKey);

  const incomingSignals = (Array.isArray(signals) ? signals : [])
    .map((item) => normalizeSignal(item, tenantKey))
    .filter((item) => item.tenant_id === tenantKey);

  const opened = [];
  const merged = [];

  for (const incoming of incomingSignals) {
    const existingIndex = activeSignals.findIndex((item) => isEquivalentWithinWindow(item, incoming, dedupWindowMinutes));
    if (existingIndex >= 0) {
      const next = mergeEquivalentSignal(activeSignals[existingIndex], incoming);
      activeSignals[existingIndex] = next;
      merged.push(next);
      continue;
    }
    const created = {
      ...incoming,
      status: 'open',
      created_at: nowIso(),
      updated_at: nowIso(),
      resolved_at: null,
    };
    activeSignals.push(created);
    opened.push(created);
  }

  const touched = Array.from(new Map(
    [...opened, ...merged]
      .filter((item) => safeStr(item?.id))
      .map((item) => [String(item.id), item]),
  ).values());

  if (touched.length > 0) {
    const upsertOut = await signalStateStoreV2.upsertSignals({
      tenantId: tenantKey,
      items: touched,
    });
    if (!upsertOut?.ok) {
      return { ok: false, error: upsertOut?.error || 'signals_unavailable' };
    }
  }

  const listOut = await signalStateStoreV2.listSignals({
    tenantId: tenantKey,
    activeOnly: false,
    limit: 1000,
  });

  return {
    ok: true,
    opened,
    merged,
    items: listOut?.ok ? (listOut.items || []) : touched,
  };
}

async function listSignals({ tenantId, contactId = null, statuses = null, activeOnly = false, limit = 200 }) {
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  return signalStateStoreV2.listSignals({
    tenantId: tenantKey,
    contactId,
    statuses: normalizeStatuses(statuses),
    activeOnly,
    limit,
  });
}

async function updateSignalStatus({ tenantId, signalId, status, resolvedAt = null }) {
  const tenantKey = safeStr(tenantId);
  const signalKey = safeStr(signalId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!signalKey) return { ok: false, error: 'signal_id_required' };

  const nextStatus = normalizeStatus(status, null);
  if (!nextStatus) return { ok: false, error: 'invalid_status' };

  const loaded = await signalStateStoreV2.listSignals({
    tenantId: tenantKey,
    activeOnly: false,
    limit: 1000,
  });
  if (!loaded?.ok) return { ok: false, error: loaded?.error || 'signals_unavailable' };

  const current = (loaded.items || []).find((item) => item.tenant_id === tenantKey && String(item.id) === signalKey);
  if (!current) return { ok: false, error: 'signal_not_found' };

  const next = {
    ...current,
    status: nextStatus,
    resolved_at: (nextStatus === 'resolved' || nextStatus === 'expired')
      ? (resolvedAt ? new Date(resolvedAt).toISOString() : nowIso())
      : null,
    updated_at: nowIso(),
  };

  const upsertOut = await signalStateStoreV2.upsertSignals({
    tenantId: tenantKey,
    items: [next],
  });
  if (!upsertOut?.ok) return { ok: false, error: upsertOut?.error || 'signals_unavailable' };

  return {
    ok: true,
    item: next,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  normalizeSignal,
  upsertDetectedSignals,
  listSignals,
  updateSignalStatus,
};

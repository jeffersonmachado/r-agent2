'use strict';

const { Op } = require('sequelize');
const { OperationalSignal } = require('../../db/models');
const getOperationalSignal = require('../../db/models/OperationalSignal');

const ACTIVE_STATUSES = new Set(['open', 'acknowledged']);
const ALL_STATUSES = new Set(['open', 'acknowledged', 'resolved', 'expired']);
const ALL_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStatus(value, fallback = 'open') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ALL_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeSeverity(value, fallback = 'medium') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ALL_SEVERITIES.has(normalized) ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function mapSignalToRow(item, tenantId) {
  const tenantKey = safeString(item?.tenant_id || item?.tenantId) || safeString(tenantId);
  return {
    id: safeString(item?.id),
    tenant_key: tenantKey,
    contact_id: safeString(item?.contact_id || item?.contactId),
    signal_type: safeString(item?.type) || 'channel_attention',
    status: normalizeStatus(item?.status, 'open'),
    severity: normalizeSeverity(item?.severity, 'medium'),
    confidence: toFiniteNumber(item?.confidence, 0.5),
    source_module: safeString(item?.source_module || item?.sourceModule) || 'operational_agent',
    context_json: safeObject(item?.context_json || item?.context),
    detected_at: toIso(item?.detected_at || item?.detectedAt, new Date().toISOString()),
    resolved_at: toIso(item?.resolved_at || item?.resolvedAt, null),
    created_at: toIso(item?.created_at || item?.createdAt, new Date().toISOString()),
    updated_at: toIso(item?.updated_at || item?.updatedAt, new Date().toISOString()),
  };
}

function mapRowToSignal(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: safeString(item?.id),
    tenant_id: safeString(item?.tenant_key),
    contact_id: safeString(item?.contact_id),
    type: safeString(item?.signal_type) || 'channel_attention',
    status: normalizeStatus(item?.status, 'open'),
    severity: normalizeSeverity(item?.severity, 'medium'),
    confidence: toFiniteNumber(item?.confidence, 0.5),
    source_module: safeString(item?.source_module) || 'operational_agent',
    context_json: safeObject(item?.context_json),
    detected_at: toIso(item?.detected_at, new Date().toISOString()),
    resolved_at: toIso(item?.resolved_at, null),
    created_at: toIso(item?.created_at, new Date().toISOString()),
    updated_at: toIso(item?.updated_at, new Date().toISOString()),
  };
}

async function upsertSignals({ tenantId, items = [] }) {
  const tenantKey = safeString(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const Model = typeof OperationalSignal === 'function' ? OperationalSignal() : getOperationalSignal();
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => mapSignalToRow(item, tenantKey))
    .filter((item) => item.id && item.tenant_key === tenantKey);

  let upserted = 0;
  for (const next of normalized) {
    const existing = await Model.findByPk(next.id);
    if (existing) {
      const row = existing.toJSON ? existing.toJSON() : existing;
      if (String(row.tenant_key || '') !== tenantKey) continue;
      await existing.update({
        contact_id: next.contact_id,
        signal_type: next.signal_type,
        status: next.status,
        severity: next.severity,
        confidence: next.confidence,
        source_module: next.source_module,
        context_json: next.context_json,
        detected_at: next.detected_at,
        resolved_at: next.resolved_at,
        updated_at: next.updated_at,
      });
      upserted += 1;
      continue;
    }

    await Model.create(next);
    upserted += 1;
  }

  return { ok: true, upserted };
}

async function listSignals({ tenantId, contactId = null, signalId = null, type = null, severity = null, statuses = null, activeOnly = false, limit = 200 }) {
  const tenantKey = safeString(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const where = { tenant_key: tenantKey };
  const contactKey = safeString(contactId);
  if (contactKey) where.contact_id = contactKey;

  const signalKey = safeString(signalId);
  if (signalKey) where.id = signalKey;

  const typeKey = safeString(type);
  if (typeKey) where.signal_type = typeKey;

  const severityKey = safeString(severity);
  if (severityKey) where.severity = severityKey;

  if (activeOnly) {
    where.status = { [Op.in]: Array.from(ACTIVE_STATUSES) };
  } else if (Array.isArray(statuses) && statuses.length > 0) {
    where.status = {
      [Op.in]: statuses
        .map((item) => normalizeStatus(item, null))
        .filter(Boolean),
    };
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const Model = typeof OperationalSignal === 'function' ? OperationalSignal() : getOperationalSignal();
  const out = await Model.findAndCountAll({
    where,
    order: [['detected_at', 'DESC'], ['updated_at', 'DESC']],
    limit: safeLimit,
  });

  return {
    ok: true,
    items: (out.rows || []).map(mapRowToSignal),
    total: Number(out.count || 0),
    limit: safeLimit,
  };
}

module.exports = {
  upsertSignals,
  listSignals,
};

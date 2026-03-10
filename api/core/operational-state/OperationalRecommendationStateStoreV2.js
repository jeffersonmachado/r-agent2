'use strict';

const { OperationalRecommendation } = require('../../db/models');
const getOperationalRecommendation = require('../../db/models/OperationalRecommendation');

const ALL_STATUSES = new Set(['open', 'accepted', 'ignored', 'executed']);

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStatus(value, fallback = 'open') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ALL_STATUSES.has(normalized) ? normalized : fallback;
}

function toFiniteNumber(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toFiniteInteger(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function mapRecommendationToRow(item, tenantId) {
  const tenantKey = safeString(item?.tenant_id || item?.tenantId) || safeString(tenantId);
  return {
    id: safeString(item?.id),
    tenant_key: tenantKey,
    contact_id: safeString(item?.contact_id || item?.contactId),
    recommendation_type: safeString(item?.type || item?.recommendation_type) || 'operational_channel_attention',
    status: normalizeStatus(item?.status, 'open'),
    priority: toFiniteInteger(item?.priority, 50),
    confidence: toFiniteNumber(item?.confidence, 0.5),
    impact_level: safeString(item?.impact_level || item?.impactLevel) || 'medium',
    target_module: safeString(item?.target_module || item?.targetModule) || 'support',
    description: safeString(item?.description) || 'Recomendação operacional',
    suggested_actions_json: safeArray(item?.suggested_actions || item?.suggestedActions),
    context_json: safeObject(item?.context_json || item?.context),
    source_signal_id: safeString(item?.source_signal_id || item?.sourceSignalId),
    source_signal_type: safeString(item?.source_signal_type || item?.sourceSignalType),
    resolved_at: toIso(item?.resolved_at || item?.resolvedAt, null),
    created_at: toIso(item?.created_at || item?.createdAt, new Date().toISOString()),
    updated_at: toIso(item?.updated_at || item?.updatedAt, new Date().toISOString()),
  };
}

function mapRowToRecommendation(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: safeString(item?.id),
    tenant_id: safeString(item?.tenant_key),
    contact_id: safeString(item?.contact_id),
    type: safeString(item?.recommendation_type) || 'operational_channel_attention',
    status: normalizeStatus(item?.status, 'open'),
    priority: toFiniteInteger(item?.priority, 50),
    confidence: toFiniteNumber(item?.confidence, 0.5),
    impact_level: safeString(item?.impact_level) || 'medium',
    target_module: safeString(item?.target_module) || 'support',
    description: safeString(item?.description) || 'Recomendação operacional',
    suggested_actions: safeArray(item?.suggested_actions_json),
    context_json: safeObject(item?.context_json),
    source_signal_id: safeString(item?.source_signal_id),
    source_signal_type: safeString(item?.source_signal_type),
    created_at: toIso(item?.created_at, new Date().toISOString()),
    updated_at: toIso(item?.updated_at, new Date().toISOString()),
    resolved_at: toIso(item?.resolved_at, null),
  };
}

async function upsertRecommendations({ tenantId, items = [] }) {
  const tenantKey = safeString(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const Model = typeof OperationalRecommendation === 'function'
    ? OperationalRecommendation()
    : getOperationalRecommendation();
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => mapRecommendationToRow(item, tenantKey))
    .filter((item) => item.id && item.tenant_key === tenantKey);

  let upserted = 0;
  for (const next of normalized) {
    const existing = await Model.findByPk(next.id);
    if (existing) {
      const row = existing.toJSON ? existing.toJSON() : existing;
      if (String(row.tenant_key || '') !== tenantKey) continue;
      await existing.update({
        contact_id: next.contact_id,
        recommendation_type: next.recommendation_type,
        status: next.status,
        priority: next.priority,
        confidence: next.confidence,
        impact_level: next.impact_level,
        target_module: next.target_module,
        description: next.description,
        suggested_actions_json: next.suggested_actions_json,
        context_json: next.context_json,
        source_signal_id: next.source_signal_id,
        source_signal_type: next.source_signal_type,
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

async function listRecommendations({ tenantId, contactId = null, recommendationId = null, sourceSignalId = null, status = null, priority = null, type = null, limit = 200 }) {
  const tenantKey = safeString(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const where = { tenant_key: tenantKey };
  const contactKey = safeString(contactId);
  if (contactKey) where.contact_id = contactKey;

  const recommendationKey = safeString(recommendationId);
  if (recommendationKey) where.id = recommendationKey;

  const sourceSignalKey = safeString(sourceSignalId);
  if (sourceSignalKey) where.source_signal_id = sourceSignalKey;

  const statusKey = safeString(status);
  if (statusKey) where.status = normalizeStatus(statusKey, 'open');

  const typeKey = safeString(type);
  if (typeKey) where.recommendation_type = typeKey;

  const priorityNumber = Number(priority);
  if (Number.isFinite(priorityNumber)) where.priority = Math.round(priorityNumber);

  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const Model = typeof OperationalRecommendation === 'function'
    ? OperationalRecommendation()
    : getOperationalRecommendation();
  const out = await Model.findAndCountAll({
    where,
    order: [['priority', 'DESC'], ['updated_at', 'DESC']],
    limit: safeLimit,
  });

  return {
    ok: true,
    items: (out.rows || []).map(mapRowToRecommendation),
    total: Number(out.count || 0),
    limit: safeLimit,
  };
}

module.exports = {
  upsertRecommendations,
  listRecommendations,
};

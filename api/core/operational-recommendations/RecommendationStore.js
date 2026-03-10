'use strict';

const recommendationStateStoreV2 = require('../operational-state/OperationalRecommendationStateStoreV2');

const RECOMMENDATION_STATUSES = new Set(['open', 'accepted', 'ignored', 'executed']);

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRecommendationStatus(value, fallback = 'open') {
  const normalized = String(value || fallback).trim().toLowerCase();
  return RECOMMENDATION_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRecommendation(item, tenantId) {
  const context = safeObject(item?.context_json || item?.context);
  const suggestedActions = Array.isArray(item?.suggested_actions || item?.suggestedActions)
    ? (item.suggested_actions || item.suggestedActions)
    : [];

  const priority = Number(item?.priority);
  const confidence = Number(item?.confidence);

  return {
    id: safeString(item?.id),
    tenant_id: safeString(item?.tenant_id || item?.tenantId) || safeString(tenantId),
    contact_id: safeString(item?.contact_id || item?.contactId),
    type: safeString(item?.type) || 'review_operational_signal',
    status: normalizeRecommendationStatus(item?.status, 'open'),
    priority: Number.isFinite(priority) ? priority : 50,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    impact_level: safeString(item?.impact_level || item?.impactLevel) || 'medium',
    target_module: safeString(item?.target_module || item?.targetModule) || 'support',
    description: safeString(item?.description) || 'Recomendação operacional',
    suggested_actions: suggestedActions,
    context_json: context,
    source_signal_id: safeString(item?.source_signal_id || item?.sourceSignalId),
    source_signal_type: safeString(item?.source_signal_type || item?.sourceSignalType),
    created_at: item?.created_at ? new Date(item.created_at).toISOString() : nowIso(),
    updated_at: nowIso(),
    resolved_at: item?.resolved_at ? new Date(item.resolved_at).toISOString() : null,
  };
}

function normalizeStore(value) {
  const base = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(base.items) ? base.items : [];
  return {
    items: items
      .map((item) => normalizeRecommendation(item, item?.tenant_id || item?.tenantId))
      .filter((item) => !!item?.id && !!item?.tenant_id),
  };
}

class RecommendationStore {
  async upsertRecommendations({ tenantId, recommendations = [] } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const existingOut = await recommendationStateStoreV2.listRecommendations({
      tenantId: tenantKey,
      limit: 1000,
    });
    if (!existingOut?.ok) {
      return { ok: false, error: existingOut?.error || 'recommendations_unavailable' };
    }

    const existingItems = Array.isArray(existingOut.items) ? existingOut.items : [];
    const generated = [];
    const touchedById = new Map();

    for (const item of Array.isArray(recommendations) ? recommendations : []) {
      const normalized = normalizeRecommendation(item, tenantKey);
      if (!normalized.id) continue;

      const existing = existingItems.find((stored) =>
        String(stored.source_signal_id || '') === String(normalized.source_signal_id || '')
        && String(stored.type || '') === String(normalized.type || '')
      );

      if (existing) {
        const updated = {
          ...existing,
          ...normalized,
          id: existing.id,
          status: existing.status,
          resolved_at: existing.resolved_at || normalized.resolved_at || null,
          updated_at: nowIso(),
        };
        touchedById.set(String(updated.id), updated);
        continue;
      }

      generated.push(normalized);
      touchedById.set(String(normalized.id), normalized);
    }

    const touched = Array.from(touchedById.values());
    if (touched.length > 0) {
      const upsertOut = await recommendationStateStoreV2.upsertRecommendations({
        tenantId: tenantKey,
        items: touched,
      });
      if (!upsertOut?.ok) {
        return { ok: false, error: upsertOut?.error || 'recommendations_unavailable' };
      }
    }

    const listed = await recommendationStateStoreV2.listRecommendations({
      tenantId: tenantKey,
      limit: 1000,
    });

    return {
      ok: true,
      generated,
      items: listed?.ok ? (listed.items || []) : touched,
      total: listed?.ok ? Number(listed.total || 0) : touched.length,
    };
  }

  async listRecommendations({ tenantId, contactId = null, limit = 200 } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    return recommendationStateStoreV2.listRecommendations({
      tenantId: tenantKey,
      contactId: safeString(contactId),
      limit,
    });
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status } = {}) {
    const tenantKey = safeString(tenantId);
    const recommendationKey = safeString(recommendationId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!recommendationKey) return { ok: false, error: 'recommendation_id_required' };

    const nextStatus = normalizeRecommendationStatus(status, null);
    if (!nextStatus) return { ok: false, error: 'invalid_status' };

    const loaded = await recommendationStateStoreV2.listRecommendations({
      tenantId: tenantKey,
      limit: 1000,
    });
    if (!loaded?.ok) {
      return { ok: false, error: loaded?.error || 'recommendations_unavailable' };
    }

    const current = (loaded.items || []).find((item) => item.tenant_id === tenantKey && String(item.id) === recommendationKey);
    if (!current) return { ok: false, error: 'recommendation_not_found' };

    const updated = {
      ...current,
      status: nextStatus,
      resolved_at: (nextStatus === 'accepted' || nextStatus === 'ignored' || nextStatus === 'executed') ? nowIso() : null,
      updated_at: nowIso(),
    };

    const upsertOut = await recommendationStateStoreV2.upsertRecommendations({
      tenantId: tenantKey,
      items: [updated],
    });
    if (!upsertOut?.ok) {
      return { ok: false, error: upsertOut?.error || 'recommendations_unavailable' };
    }

    return { ok: true, item: updated };
  }

  async #findExistingBySource(existingItems = [], normalized = {}) {
    return existingItems.find((existing) =>
        String(existing.source_signal_id || '') === String(normalized.source_signal_id || '')
        && String(existing.type || '') === String(normalized.type || '')
      );
  }
}

module.exports = {
  RecommendationStore,
  normalizeRecommendationStatus,
};

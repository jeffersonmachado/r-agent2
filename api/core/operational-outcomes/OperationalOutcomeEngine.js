'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../../utils/logger');
const { OperationalOutcome } = require('../../db/models');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeDate(value) {
  if (!value) return new Date();
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function newOutcomeId() {
  return `opout-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

class OperationalOutcomeEngine {
  constructor({
    outcomeModel,
    outcomeClassifier,
    outcomeAttributionService,
  } = {}) {
    this.outcomeModel = outcomeModel || null;
    this.outcomeClassifier = outcomeClassifier || null;
    this.outcomeAttributionService = outcomeAttributionService || null;
  }

  getModel() {
    if (!this.outcomeModel) {
      this.outcomeModel = typeof OperationalOutcome === 'function' ? OperationalOutcome() : null;
    }
    return this.outcomeModel;
  }

  async recordOutcome({
    tenantId,
    contactId = null,
    signalId = null,
    recommendationId = null,
    playbookExecutionId = null,
    sourceType = null,
    sourceId = null,
    actionId = null,
    actionType = null,
    outcomeType,
    outcomeScore = null,
    status = 'success',
    producedAt = new Date(),
    resultContext = {},
  } = {}) {
    const tenantKey = safeString(tenantId);
    const typeKey = safeString(outcomeType);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!typeKey) return { ok: false, error: 'outcome_type_required' };

    const model = this.getModel();
    if (!model || typeof model.create !== 'function') {
      return { ok: false, error: 'operational_outcome_model_unavailable' };
    }

    const signalKey = safeString(signalId);
    const recommendationKey = safeString(recommendationId);
    const playbookExecutionKey = safeString(playbookExecutionId);

    const sourceTypeKey = safeString(sourceType)
      || (recommendationKey ? 'recommendation' : (signalKey ? 'signal' : (playbookExecutionKey ? 'playbook' : 'event')));
    const sourceIdKey = safeString(sourceId)
      || recommendationKey
      || signalKey
      || playbookExecutionKey
      || safeString(resultContext?.correlationId)
      || newOutcomeId();

    const actionIdKey = safeString(actionId);
    const actionTypeKey = safeString(actionType) || actionIdKey;
    const producedAtDate = normalizeDate(producedAt);
    const score = safeNumber(outcomeScore, null);
    const contextSafe = safeObject(resultContext);

    try {
      const row = await model.create({
        id: newOutcomeId(),
        tenant_key: tenantKey,
        contact_id: safeString(contactId),
        signal_id: signalKey,
        recommendation_id: recommendationKey,
        playbook_execution_id: playbookExecutionKey,
        source_type: sourceTypeKey,
        source_id: sourceIdKey,
        action_type: actionTypeKey,
        action_id: actionIdKey || actionTypeKey,
        outcome_type: typeKey,
        outcome_score: score,
        status: safeString(status) || 'success',
        result_context_json: contextSafe,
        details_json: contextSafe,
        produced_at: producedAtDate,
      });

      const item = row && typeof row.toJSON === 'function' ? row.toJSON() : row;

      try {
        const { operationalMemoryService } = require('../operational-memory');
        await operationalMemoryService.recordOutcome({
          tenantId: tenantKey,
          contactId: safeString(contactId),
          outcome: item,
          signalId: signalKey,
          recommendationId: recommendationKey,
          playbookExecutionId: playbookExecutionKey,
          sourceType: sourceTypeKey,
          sourceId: sourceIdKey,
          outcomeType: typeKey,
          status: safeString(status) || 'success',
          producedAt: producedAtDate,
          resultContext: contextSafe,
        });
      } catch (_) {}

      return {
        ok: true,
        item,
      };
    } catch (err) {
      logger.debug('[OperationalOutcomeEngine] Falha ao registrar outcome (ignorado)', {
        tenantId: tenantKey,
        outcomeType: typeKey,
        error: err?.message || String(err || 'unknown_error'),
      });
      return { ok: false, error: err?.message || 'operational_outcome_create_failed' };
    }
  }

  async recordFromEvent(event = {}) {
    const tenantId = safeString(event.tenantId || event.tenant_id);
    if (!tenantId) return { ok: false, error: 'tenant_required' };
    if (!this.outcomeClassifier || !this.outcomeAttributionService) {
      return { ok: false, error: 'operational_outcome_dependencies_unavailable' };
    }

    const classified = this.outcomeClassifier.classifyEvent(event);
    if (!classified?.shouldRecord) {
      return { ok: true, skipped: true, reason: classified?.reason || 'event_not_mapped' };
    }

    const attribution = this.outcomeAttributionService.resolveFromEvent(event);
    const payload = safeObject(event.payload);
    const resultContext = {
      eventType: safeString(event.type || event.event_type),
      eventId: safeString(event.event_id),
      sourceModule: safeString(event.sourceModule),
      correlationId: safeString(event.correlationId),
      payload,
    };

    return this.recordOutcome({
      tenantId,
      contactId: attribution.contactId,
      signalId: attribution.signalId,
      recommendationId: attribution.recommendationId,
      playbookExecutionId: attribution.playbookExecutionId,
      sourceType: attribution.sourceType,
      sourceId: attribution.sourceId,
      actionType: attribution.actionType,
      outcomeType: classified.outcomeType,
      outcomeScore: classified.outcomeScore,
      status: classified.status,
      producedAt: event.created_at || event.createdAt || new Date(),
      resultContext,
    });
  }

  async listOutcomes({
    tenantId,
    sourceType = null,
    sourceId = null,
    actionId = null,
    actionType = null,
    status = null,
    contactId = null,
    signalId = null,
    recommendationId = null,
    playbookExecutionId = null,
    outcomeType = null,
    from = null,
    to = null,
    limit = 120,
  } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const model = this.getModel();
    if (!model || typeof model.findAll !== 'function') {
      return { ok: false, error: 'operational_outcome_model_unavailable' };
    }

    const where = { tenant_key: tenantKey };
    if (safeString(sourceType)) where.source_type = safeString(sourceType);
    if (safeString(sourceId)) where.source_id = safeString(sourceId);
    if (safeString(actionId)) where.action_id = safeString(actionId);
    if (safeString(actionType)) where.action_type = safeString(actionType);
    if (safeString(status)) where.status = safeString(status);
    if (safeString(contactId)) where.contact_id = safeString(contactId);
    if (safeString(signalId)) where.signal_id = safeString(signalId);
    if (safeString(recommendationId)) where.recommendation_id = safeString(recommendationId);
    if (safeString(playbookExecutionId)) where.playbook_execution_id = safeString(playbookExecutionId);
    if (safeString(outcomeType)) where.outcome_type = safeString(outcomeType);
    if (from || to) {
      where.produced_at = {};
      if (from) where.produced_at[Op.gte] = normalizeDate(from);
      if (to) where.produced_at[Op.lte] = normalizeDate(to);
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 120, 1000));

    try {
      const rows = await model.findAll({
        where,
        order: [['produced_at', 'DESC'], ['created_at', 'DESC']],
        limit: safeLimit,
      });
      const items = Array.isArray(rows)
        ? rows.map((row) => (row && typeof row.toJSON === 'function' ? row.toJSON() : row))
        : [];
      return {
        ok: true,
        items,
        total: items.length,
        limit: safeLimit,
      };
    } catch (err) {
      return { ok: false, error: err?.message || 'operational_outcome_list_failed' };
    }
  }

  async listSignalOutcomes({ tenantId, signalId, limit = 120, status = null } = {}) {
    return this.listOutcomes({ tenantId, signalId, sourceType: 'signal', sourceId: signalId, limit, status });
  }

  async listRecommendationOutcomes({ tenantId, recommendationId, limit = 120, status = null } = {}) {
    return this.listOutcomes({
      tenantId,
      recommendationId,
      sourceType: 'recommendation',
      sourceId: recommendationId,
      limit,
      status,
    });
  }

  async listContactOutcomes({ tenantId, contactId, limit = 120, status = null, sourceType = null, sourceId = null } = {}) {
    return this.listOutcomes({
      tenantId,
      contactId,
      limit,
      status,
      sourceType,
      sourceId,
    });
  }

  async buildOccSignalOutcomeMap({ tenantId, signalIds = [], signalDetectedAtById = {} } = {}) {
    const tenantKey = safeString(tenantId);
    const ids = Array.isArray(signalIds)
      ? signalIds.map((item) => safeString(item)).filter(Boolean)
      : [];
    if (!tenantKey || ids.length === 0) return {};

    const model = this.getModel();
    if (!model || typeof model.findAll !== 'function') return {};

    let rows = [];
    try {
      rows = await model.findAll({
        where: {
          tenant_key: tenantKey,
          signal_id: { [Op.in]: ids },
        },
        order: [['produced_at', 'DESC'], ['created_at', 'DESC']],
        limit: Math.max(ids.length * 6, 120),
      });
    } catch {
      return {};
    }

    const latestBySignal = {};
    for (const row of rows || []) {
      const item = row && typeof row.toJSON === 'function' ? row.toJSON() : row;
      const signalId = safeString(item?.signal_id);
      if (!signalId) continue;
      if (!latestBySignal[signalId]) {
        latestBySignal[signalId] = item;
      }
    }

    const out = {};
    for (const signalId of ids) {
      const item = latestBySignal[signalId] || null;
      if (!item) {
        out[signalId] = {
          lastOutcome: null,
          hasSuccessfulOutcome: false,
          timeToResolutionMs: null,
        };
        continue;
      }

      const producedAt = new Date(item.produced_at || item.created_at || Date.now());
      const producedAtMs = Number.isNaN(producedAt.getTime()) ? null : producedAt.getTime();
      const detectedRaw = signalDetectedAtById[signalId]
        || item?.result_context_json?.detectedAt
        || item?.result_context_json?.detected_at
        || null;
      const detectedAt = detectedRaw ? new Date(detectedRaw) : null;
      const detectedAtMs = detectedAt && !Number.isNaN(detectedAt.getTime()) ? detectedAt.getTime() : null;

      out[signalId] = {
        lastOutcome: item,
        hasSuccessfulOutcome: String(item.status || '').toLowerCase() === 'success'
          || (safeNumber(item.outcome_score, 0) >= 0.6),
        timeToResolutionMs: (producedAtMs != null && detectedAtMs != null && producedAtMs >= detectedAtMs)
          ? (producedAtMs - detectedAtMs)
          : null,
      };
    }

    return out;
  }

  isEnabledForOcc(value) {
    return normalizeBoolean(value, false);
  }
}

module.exports = {
  OperationalOutcomeEngine,
};

'use strict';

const { Op } = require('sequelize');
const { getSequelize } = require('../../db/sequelize');
const { OperationalOutcome } = require('../../db/models');
const conversationMemoryService = require('../../services/conversationMemoryService');
const conversationContextService = require('../../services/conversationContextService');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  if (!value) return new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildSyntheticTicketId({ tenantId, contactId = null, sourceType = 'operational', sourceId = null } = {}) {
  return [
    'operational',
    safeString(tenantId) || 'tenant',
    safeString(contactId) || safeString(sourceType) || 'scope',
    safeString(sourceId) || 'global',
  ].join(':');
}

function toIso(value) {
  return normalizeDate(value).toISOString();
}

class OperationalMemoryService {
  constructor({ sequelize, outcomeModel } = {}) {
    this.sequelize = sequelize || null;
    this.outcomeModel = outcomeModel || null;
  }

  async indexMemoryEntry(payload = {}) {
    return conversationMemoryService.indexMemoryEntry(payload);
  }

  async searchRelevantMemories(payload = {}) {
    const items = await conversationMemoryService.searchRelevantMemories(payload);
    return {
      ok: true,
      items,
      total: Array.isArray(items) ? items.length : 0,
    };
  }

  async buildConversationContext(payload = {}) {
    return conversationContextService.buildConversationContext(payload);
  }

  async recordOutcome({
    tenantId,
    contactId = null,
    outcome = null,
    signalId = null,
    recommendationId = null,
    playbookExecutionId = null,
    sourceType = 'outcome',
    sourceId = null,
    outcomeType = null,
    status = null,
    producedAt = new Date(),
    resultContext = {},
  } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const content = [
      `Outcome ${safeString(outcomeType || outcome?.outcome_type) || 'operational_outcome'}`,
      `status ${safeString(status || outcome?.status) || 'unknown'}`,
      signalId || outcome?.signal_id ? `signal ${safeString(signalId || outcome?.signal_id)}` : null,
      recommendationId || outcome?.recommendation_id ? `recommendation ${safeString(recommendationId || outcome?.recommendation_id)}` : null,
      playbookExecutionId || outcome?.playbook_execution_id ? `playbook ${safeString(playbookExecutionId || outcome?.playbook_execution_id)}` : null,
    ].filter(Boolean).join(' | ');

    const indexed = await this.indexMemoryEntry({
      tenantId: tenantKey,
      ticketId: buildSyntheticTicketId({
        tenantId: tenantKey,
        contactId,
        sourceType: sourceType || outcome?.source_type || 'outcome',
        sourceId: sourceId || outcome?.id || outcome?.source_id,
      }),
      conversationId: safeString(playbookExecutionId || outcome?.playbook_execution_id),
      sourceType: 'operational_outcome',
      sourceId: safeString(sourceId || outcome?.id || outcome?.source_id || outcome?.recommendation_id || outcome?.signal_id),
      content,
      metadata: {
        kind: 'operational_outcome',
        tenantId: tenantKey,
        contactId: safeString(contactId || outcome?.contact_id),
        signalId: safeString(signalId || outcome?.signal_id),
        recommendationId: safeString(recommendationId || outcome?.recommendation_id),
        playbookExecutionId: safeString(playbookExecutionId || outcome?.playbook_execution_id),
        outcomeType: safeString(outcomeType || outcome?.outcome_type),
        status: safeString(status || outcome?.status),
        producedAt: toIso(producedAt || outcome?.produced_at),
        resultContext: safeObject(resultContext || outcome?.result_context_json),
      },
    });

    return {
      ok: true,
      indexed,
    };
  }

  async recordDecision({
    tenantId,
    contactId = null,
    sourceType = null,
    sourceId = null,
    actionId = null,
    decisionType = 'selected',
    actionMode = null,
    reason = null,
    metadata = {},
  } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const content = [
      `Decision ${safeString(decisionType) || 'selected'}`,
      sourceType ? `source ${safeString(sourceType)}` : null,
      sourceId ? `id ${safeString(sourceId)}` : null,
      actionId ? `action ${safeString(actionId)}` : null,
      actionMode ? `mode ${safeString(actionMode)}` : null,
      reason ? `reason ${safeString(reason)}` : null,
    ].filter(Boolean).join(' | ');

    const indexed = await this.indexMemoryEntry({
      tenantId: tenantKey,
      ticketId: buildSyntheticTicketId({ tenantId: tenantKey, contactId, sourceType: sourceType || 'decision', sourceId }),
      sourceType: 'operational_decision',
      sourceId: safeString(sourceId || actionId),
      content,
      metadata: {
        kind: 'operational_decision',
        tenantId: tenantKey,
        contactId: safeString(contactId),
        sourceType: safeString(sourceType),
        sourceId: safeString(sourceId),
        actionId: safeString(actionId),
        decisionType: safeString(decisionType),
        actionMode: safeString(actionMode),
        reason: safeString(reason),
        metadata: safeObject(metadata),
      },
    });

    return { ok: true, indexed };
  }

  async recordRecommendationFeedback({
    tenantId,
    contactId = null,
    recommendationId,
    status,
    actorId = null,
    metadata = {},
  } = {}) {
    const tenantKey = safeString(tenantId);
    const recommendationKey = safeString(recommendationId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!recommendationKey) return { ok: false, error: 'recommendation_required' };

    const indexed = await this.indexMemoryEntry({
      tenantId: tenantKey,
      ticketId: buildSyntheticTicketId({ tenantId: tenantKey, contactId, sourceType: 'recommendation', sourceId: recommendationKey }),
      sourceType: 'operational_recommendation_feedback',
      sourceId: recommendationKey,
      content: `Recommendation feedback | recommendation ${recommendationKey} | status ${safeString(status) || 'unknown'}`,
      metadata: {
        kind: 'operational_recommendation_feedback',
        tenantId: tenantKey,
        contactId: safeString(contactId),
        recommendationId: recommendationKey,
        status: safeString(status),
        actorId: safeString(actorId),
        metadata: safeObject(metadata),
      },
    });

    return { ok: true, indexed };
  }

  async getRecentOperationalLearnings({ tenantId, limit = 20 } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required', items: [] };

    const sequelize = this.sequelize || getSequelize();
    if (!sequelize) return { ok: true, items: [], total: 0 };

    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

    try {
      const [rows] = await sequelize.query(
        `
          SELECT id, ticket_id, conversation_id, source_type, source_id, content, metadata_json, created_at
          FROM conversation_memory_embeddings
          WHERE tenant_key = :tenantKey
            AND source_type IN (
              'operational_outcome',
              'operational_decision',
              'operational_recommendation_feedback'
            )
          ORDER BY created_at DESC
          LIMIT :limit
        `,
        {
          replacements: {
            tenantKey,
            limit: safeLimit,
          },
        }
      );

      const items = (rows || []).map((row) => ({
        id: row.id,
        ticketId: row.ticket_id,
        conversationId: row.conversation_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        content: row.content,
        metadata: safeObject(row.metadata_json),
        createdAt: row.created_at || null,
      }));

      return {
        ok: true,
        items,
        total: items.length,
      };
    } catch (err) {
      return { ok: false, error: err?.message || 'operational_learning_query_failed', items: [] };
    }
  }

  async getOutcomeStats({ tenantId, from = null, to = null } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const Model = this.outcomeModel || (typeof OperationalOutcome === 'function' ? OperationalOutcome() : null);
    if (!Model || typeof Model.findAll !== 'function') {
      return { ok: true, items: [], summary: { total: 0, success: 0, failed: 0, successRate: 0 } };
    }

    const where = { tenant_key: tenantKey };
    const dateFrom = from ? normalizeDate(from) : null;
    const dateTo = to ? normalizeDate(to) : null;
    if (dateFrom || dateTo) {
      where.produced_at = {};
      if (dateFrom) where.produced_at[Op.gte] = dateFrom;
      if (dateTo) where.produced_at[Op.lte] = dateTo;
    }

    try {
      const rows = await Model.findAll({ where });
      const items = Array.isArray(rows)
        ? rows.map((row) => (row && typeof row.toJSON === 'function' ? row.toJSON() : row))
        : [];

      const byType = new Map();
      let success = 0;
      let failed = 0;

      for (const item of items) {
        const type = safeString(item?.outcome_type) || 'unknown';
        const current = byType.get(type) || { outcomeType: type, total: 0, success: 0, failed: 0, averageScore: 0, scoreCount: 0 };
        current.total += 1;
        if (String(item?.status || '').toLowerCase() === 'success') {
          current.success += 1;
          success += 1;
        } else {
          current.failed += 1;
          failed += 1;
        }
        const score = Number(item?.outcome_score);
        if (Number.isFinite(score)) {
          current.averageScore += score;
          current.scoreCount += 1;
        }
        byType.set(type, current);
      }

      const summaryItems = Array.from(byType.values()).map((item) => ({
        outcomeType: item.outcomeType,
        total: item.total,
        success: item.success,
        failed: item.failed,
        averageScore: item.scoreCount > 0 ? Number((item.averageScore / item.scoreCount).toFixed(3)) : null,
      }));

      return {
        ok: true,
        items: summaryItems,
        summary: {
          total: items.length,
          success,
          failed,
          successRate: items.length > 0 ? Number((success / items.length).toFixed(3)) : 0,
        },
      };
    } catch (err) {
      return { ok: false, error: err?.message || 'operational_outcome_stats_failed' };
    }
  }
}

module.exports = {
  OperationalMemoryService,
};

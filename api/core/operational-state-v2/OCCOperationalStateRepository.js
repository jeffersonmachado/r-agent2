'use strict';

const { Op, fn, col } = require('sequelize');
const {
  OperationalSignal,
  OperationalRecommendation,
} = require('../../db/models');
const getOperationalSignal = require('../../db/models/OperationalSignal');
const getOperationalRecommendation = require('../../db/models/OperationalRecommendation');
const { resolveOperationalPlaybookRunModel } = require('../operational-compat');

const SIGNAL_ACTIVE_STATUSES = ['open', 'acknowledged'];
const PLAYBOOK_ACTIVE_STATUSES = ['in_progress', 'running', 'pending'];

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeNumber(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeListFilter(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => safeString(item))
      .filter(Boolean);
  }

  const raw = safeString(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => safeString(item))
    .filter(Boolean);
}

function normalizeCount(countValue) {
  if (Array.isArray(countValue)) {
    return countValue.length;
  }
  const parsed = Number(countValue || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveModel(candidate, fallbackFactory) {
  if (candidate && typeof candidate.findAndCountAll === 'function') {
    return candidate;
  }
  if (typeof candidate === 'function') {
    return candidate();
  }
  return fallbackFactory();
}

function getUtcDayStartIso() {
  const now = new Date();
  const utcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return utcStart.toISOString();
}

function severityRank(severity) {
  const normalized = String(severity || '').trim().toLowerCase();
  if (normalized === 'critical') return 4;
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  return 1;
}

function buildDateRangeWhere({ from = null, to = null } = {}) {
  const fromIso = toIso(from);
  const toIsoValue = toIso(to);
  if (!fromIso && !toIsoValue) return null;

  const range = {};
  if (fromIso) range[Op.gte] = fromIso;
  if (toIsoValue) range[Op.lte] = toIsoValue;
  return range;
}

function mapSignal(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: safeString(item?.id),
    type: safeString(item?.signal_type),
    status: safeString(item?.status) || 'open',
    severity: safeString(item?.severity) || 'medium',
    confidence: safeNumber(item?.confidence, 0.5),
    source_module: safeString(item?.source_module) || 'operational_agent',
    contact_id: safeString(item?.contact_id),
    detected_at: toIso(item?.detected_at),
    resolved_at: toIso(item?.resolved_at),
    tenant_id: safeString(item?.tenant_key),
    context_json: item?.context_json && typeof item.context_json === 'object' ? item.context_json : {},
    created_at: toIso(item?.created_at),
    updated_at: toIso(item?.updated_at),
  };
}

function mapRecommendation(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: safeString(item?.id),
    type: safeString(item?.recommendation_type),
    priority: safeNumber(item?.priority, 50),
    confidence: safeNumber(item?.confidence, 0.5),
    impact_level: safeString(item?.impact_level) || 'medium',
    status: safeString(item?.status) || 'open',
    contact_id: safeString(item?.contact_id),
    signal_id: safeString(item?.source_signal_id),
    source_signal_id: safeString(item?.source_signal_id),
    source_signal_type: safeString(item?.source_signal_type),
    created_at: toIso(item?.created_at),
    tenant_id: safeString(item?.tenant_key),
    updated_at: toIso(item?.updated_at),
  };
}

function mapPlaybookExecution(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  const currentStepIndex = Number.isFinite(Number(item?.current_step_index))
    ? Number(item.current_step_index)
    : 0;

  return {
    id: safeString(item?.id),
    playbook_id: safeString(item?.playbook_id),
    status: safeString(item?.status) || 'in_progress',
    current_step: currentStepIndex,
    current_step_index: currentStepIndex,
    contact_id: safeString(item?.contact_id),
    started_at: toIso(item?.created_at),
    completed_at: toIso(item?.completed_at),
    tenant_id: safeString(item?.tenant_key),
    recommendation_id: safeString(item?.recommendation_id),
    signal_id: safeString(item?.signal_id),
    updated_at: toIso(item?.updated_at),
  };
}

class OCCOperationalStateRepository {
  constructor({
    signalModel,
    recommendationModel,
    playbookExecutionModel,
  } = {}) {
    this.signalModel = resolveModel(signalModel || OperationalSignal, getOperationalSignal);
    this.recommendationModel = resolveModel(
      recommendationModel || OperationalRecommendation,
      getOperationalRecommendation,
    );
    this.playbookExecutionModel = playbookExecutionModel || resolveOperationalPlaybookRunModel();
  }

  async getSignals(filters = {}) {
    const tenantId = safeString(filters.tenantId || filters.tenant || filters.tenant_id);
    if (!tenantId) return { ok: false, error: 'tenant_required' };

    const where = { tenant_key: tenantId };

    const contactId = safeString(filters.contactId || filters.contact || filters.contact_id);
    if (contactId) where.contact_id = contactId;

    const signalId = safeString(filters.signalId || filters.signal_id || filters.id);
    if (signalId) where.id = signalId;

    const statuses = normalizeListFilter(filters.status || filters.statuses);
    const activeOnly = filters.activeOnly === true;
    if (activeOnly) {
      where.status = { [Op.in]: SIGNAL_ACTIVE_STATUSES };
    } else if (statuses.length > 0) {
      where.status = { [Op.in]: statuses };
    }

    const severities = normalizeListFilter(filters.severity || filters.severities);
    if (severities.length > 0) {
      where.severity = { [Op.in]: severities };
    }

    const types = normalizeListFilter(filters.type || filters.types);
    if (types.length === 1) {
      where.signal_type = types[0];
    } else if (types.length > 1) {
      where.signal_type = { [Op.in]: types };
    }

    const detectedRange = buildDateRangeWhere({
      from: filters.from || filters.dateFrom || filters.startDate,
      to: filters.to || filters.dateTo || filters.endDate,
    });
    if (detectedRange) where.detected_at = detectedRange;

    const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 200, 1000));
    const out = await this.signalModel.findAndCountAll({
      where,
      order: [['detected_at', 'DESC']],
      limit: safeLimit,
    });

    const items = (out.rows || [])
      .map(mapSignal)
      .sort((left, right) => {
        const severityDiff = severityRank(right.severity) - severityRank(left.severity);
        if (severityDiff !== 0) return severityDiff;
        return Date.parse(right.detected_at || 0) - Date.parse(left.detected_at || 0);
      });

    return {
      ok: true,
      items,
      total: normalizeCount(out.count),
      limit: safeLimit,
      source: 'v2',
    };
  }

  async getRecommendations(filters = {}) {
    const tenantId = safeString(filters.tenantId || filters.tenant || filters.tenant_id);
    if (!tenantId) return { ok: false, error: 'tenant_required' };

    const where = { tenant_key: tenantId };

    const contactId = safeString(filters.contactId || filters.contact || filters.contact_id);
    if (contactId) where.contact_id = contactId;

    const recommendationId = safeString(filters.recommendationId || filters.recommendation_id || filters.id);
    if (recommendationId) where.id = recommendationId;

    const signalId = safeString(filters.signalId || filters.signal_id || filters.sourceSignalId || filters.source_signal_id);
    if (signalId) where.source_signal_id = signalId;

    const statuses = normalizeListFilter(filters.status || filters.statuses);
    if (statuses.length > 0) {
      where.status = { [Op.in]: statuses };
    }

    const types = normalizeListFilter(filters.type || filters.types);
    if (types.length === 1) {
      where.recommendation_type = types[0];
    } else if (types.length > 1) {
      where.recommendation_type = { [Op.in]: types };
    }

    const priorityMin = safeNumber(filters.priorityMin || filters.minPriority, null);
    const priorityRaw = normalizeListFilter(filters.priority || filters.priorities)
      .map((item) => safeNumber(item, null))
      .filter((item) => item != null);
    if (priorityMin != null) {
      where.priority = { [Op.gte]: priorityMin };
    } else if (priorityRaw.length === 1) {
      where.priority = priorityRaw[0];
    } else if (priorityRaw.length > 1) {
      where.priority = { [Op.in]: priorityRaw };
    }

    const createdRange = buildDateRangeWhere({
      from: filters.from || filters.dateFrom || filters.startDate,
      to: filters.to || filters.dateTo || filters.endDate,
    });
    if (createdRange) where.created_at = createdRange;

    const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 200, 1000));
    const out = await this.recommendationModel.findAndCountAll({
      where,
      order: [['priority', 'DESC'], ['created_at', 'DESC']],
      limit: safeLimit,
    });

    return {
      ok: true,
      items: (out.rows || []).map(mapRecommendation),
      total: normalizeCount(out.count),
      limit: safeLimit,
      source: 'v2',
    };
  }

  async getActivePlaybooks(filters = {}) {
    const tenantId = safeString(filters.tenantId || filters.tenant || filters.tenant_id);
    if (!tenantId) return { ok: false, error: 'tenant_required' };

    const where = { tenant_key: tenantId };

    const contactId = safeString(filters.contactId || filters.contact || filters.contact_id);
    if (contactId) where.contact_id = contactId;

    const executionId = safeString(filters.executionId || filters.execution_id || filters.id);
    if (executionId) where.id = executionId;

    const recommendationId = safeString(filters.recommendationId || filters.recommendation_id);
    if (recommendationId) where.recommendation_id = recommendationId;

    const signalId = safeString(filters.signalId || filters.signal_id);
    if (signalId) where.signal_id = signalId;

    const statuses = normalizeListFilter(filters.status || filters.statuses);
    if (statuses.length > 0) {
      where.status = { [Op.in]: statuses };
    } else {
      where.status = { [Op.in]: PLAYBOOK_ACTIVE_STATUSES };
    }

    const startedRange = buildDateRangeWhere({
      from: filters.from || filters.dateFrom || filters.startDate,
      to: filters.to || filters.dateTo || filters.endDate,
    });
    if (startedRange) where.created_at = startedRange;

    const safeLimit = Math.max(1, Math.min(Number(filters.limit) || 120, 1000));
    const out = await this.playbookExecutionModel.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: safeLimit,
    });

    return {
      ok: true,
      items: (out.rows || []).map(mapPlaybookExecution),
      total: normalizeCount(out.count),
      limit: safeLimit,
      source: 'v2',
    };
  }

  async getOperationalKPIs(tenantId) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const dayStartIso = getUtcDayStartIso();

    const [
      openSignals,
      criticalSignals,
      openRecommendations,
      activePlaybooks,
      signalsToday,
      recommendationsToday,
      critical,
      high,
      medium,
      low,
    ] = await Promise.all([
      this.signalModel.count({ where: { tenant_key: tenantKey, status: { [Op.in]: SIGNAL_ACTIVE_STATUSES } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, status: { [Op.in]: SIGNAL_ACTIVE_STATUSES }, severity: 'critical' } }),
      this.recommendationModel.count({ where: { tenant_key: tenantKey, status: 'open' } }),
      this.playbookExecutionModel.count({ where: { tenant_key: tenantKey, status: { [Op.in]: PLAYBOOK_ACTIVE_STATUSES } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, detected_at: { [Op.gte]: dayStartIso } } }),
      this.recommendationModel.count({ where: { tenant_key: tenantKey, created_at: { [Op.gte]: dayStartIso } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, severity: 'critical', status: { [Op.in]: SIGNAL_ACTIVE_STATUSES } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, severity: 'high', status: { [Op.in]: SIGNAL_ACTIVE_STATUSES } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, severity: 'medium', status: { [Op.in]: SIGNAL_ACTIVE_STATUSES } } }),
      this.signalModel.count({ where: { tenant_key: tenantKey, severity: 'low', status: { [Op.in]: SIGNAL_ACTIVE_STATUSES } } }),
    ]);

    return {
      ok: true,
      kpis: {
        openSignals: Number(openSignals || 0),
        criticalSignals: Number(criticalSignals || 0),
        openRecommendations: Number(openRecommendations || 0),
        activePlaybooks: Number(activePlaybooks || 0),
        signalsToday: Number(signalsToday || 0),
        recommendationsToday: Number(recommendationsToday || 0),
        severitySummary: {
          critical: Number(critical || 0),
          high: Number(high || 0),
          medium: Number(medium || 0),
          low: Number(low || 0),
        },
      },
      source: 'v2',
    };
  }

  async getTopOperationalSignals(tenantId, options = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const where = { tenant_key: tenantKey };
    const detectedRange = buildDateRangeWhere({
      from: options.from || options.dateFrom || options.startDate,
      to: options.to || options.dateTo || options.endDate,
    });
    if (detectedRange) where.detected_at = detectedRange;

    const safeLimit = Math.max(1, Math.min(Number(options.limit) || 5, 20));
    const rows = await this.signalModel.findAll({
      where,
      attributes: [
        ['signal_type', 'type'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['signal_type'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      limit: safeLimit,
      raw: true,
    });

    return {
      ok: true,
      items: (rows || []).map((item) => ({
        type: safeString(item?.type),
        count: Number(item?.count || 0),
      })),
      source: 'v2',
    };
  }
}

module.exports = {
  OCCOperationalStateRepository,
  SIGNAL_ACTIVE_STATUSES,
  PLAYBOOK_ACTIVE_STATUSES,
};

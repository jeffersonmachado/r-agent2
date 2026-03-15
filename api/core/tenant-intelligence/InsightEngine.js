'use strict';

const { Op } = require('sequelize');
const { TenantInsight, TenantMetricSnapshot } = require('../../db/models');
const { buildId, toNumber, resolvePeriodBounds } = require('./helpers');
const { EvidenceEngine } = require('./EvidenceEngine');
const { GoalEngine } = require('./GoalEngine');
const { MetricEngine } = require('./MetricEngine');

class InsightEngine {
  constructor({ evidenceEngine, goalEngine, metricEngine } = {}) {
    this.evidenceEngine = evidenceEngine || new EvidenceEngine();
    this.goalEngine = goalEngine || new GoalEngine();
    this.metricEngine = metricEngine || new MetricEngine();
  }

  async listInsights({ tenantId, status = null, limit = 100 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const InsightModel = TenantInsight();
    const where = { tenant_key: String(tenantId) };
    if (status) where.status = String(status);

    const rows = await InsightModel.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });

    const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    return { items, total: items.length };
  }

  async generateInsights({
    tenantId,
    period = 'month',
    filters = {},
    persist = true,
    snapshots = null,
    refreshMetrics = true,
  } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const periodBounds = resolvePeriodBounds(period, filters.period || {});
    const resolvedSnapshots = this._normalizeSnapshots(snapshots);
    const hasResolvedSnapshots = resolvedSnapshots.length > 0;

    if (!hasResolvedSnapshots && refreshMetrics) {
      await this.metricEngine.collectSnapshots({
        tenantId,
        period,
        filters,
      });
    }

    const goalsResult = await this.goalEngine.listGoals({
      tenantId,
      status: 'active',
      includeComputed: true,
      limit: 200,
    });

    const snapshotsByMetric = hasResolvedSnapshots
      ? this._groupSnapshotsByMetric(resolvedSnapshots)
      : await this._loadRecentSnapshotsByMetric({
          tenantId,
          periodStart: periodBounds.start,
          periodEnd: periodBounds.end,
        });

    const candidates = [];

    for (const goal of goalsResult.items || []) {
      const computedStatus = goal?.computed?.computedStatus;
      if (computedStatus !== 'off_track' && computedStatus !== 'at_risk') {
        continue;
      }

      const insightType = computedStatus === 'off_track' ? 'goal_off_track' : 'goal_at_risk';
      const title = `Meta fora do esperado: ${goal.name}`;
      const description = `A meta ${goal.name} esta ${computedStatus} com valor atual ${goal.current_value} e alvo ${goal.target_value}.`;

      candidates.push({
        type: insightType,
        title,
        description,
        confidence: computedStatus === 'off_track' ? 0.9 : 0.75,
        impact: (goal.priority || 'medium').toLowerCase() === 'high' ? 'high' : 'medium',
        source: 'goal_engine',
        relatedMetrics: [goal.metric_key],
        metadata: {
          goalId: goal.id,
          comparisonMode: goal.comparison_mode,
          evaluation: goal.computed,
        },
        evidences: [
          {
            evidenceType: 'goal_status',
            sourceType: 'tenant_goal',
            sourceId: goal.id,
            excerpt: `Meta ${goal.name} classificada como ${computedStatus}.`,
            structuredData: {
              metricKey: goal.metric_key,
              targetValue: goal.target_value,
              currentValue: goal.current_value,
              computed: goal.computed,
            },
          },
        ],
      });
    }

    for (const [metricKey, snapshots] of snapshotsByMetric.entries()) {
      if (!Array.isArray(snapshots) || snapshots.length < 2) continue;
      const latest = snapshots[0];
      const previous = snapshots[1];

      const latestValue = toNumber(latest.value, 0);
      const previousValue = toNumber(previous.value, 0);
      if (previousValue === 0) continue;

      const changeRatio = (latestValue - previousValue) / Math.abs(previousValue);
      const absRatio = Math.abs(changeRatio);
      if (absRatio < 0.2) continue;

      const trendType = changeRatio > 0 ? 'metric_increase' : 'metric_drop';
      const trendLabel = changeRatio > 0 ? 'aumento' : 'queda';
      const title = `${trendLabel} relevante em ${metricKey}`;

      candidates.push({
        type: trendType,
        title,
        description: `A metrica ${metricKey} variou ${Math.round(changeRatio * 100)}% no periodo analisado.`,
        confidence: Math.min(0.95, 0.55 + absRatio),
        impact: absRatio >= 0.5 ? 'high' : 'medium',
        source: 'metric_engine',
        relatedMetrics: [metricKey],
        metadata: {
          changeRatio,
          latestSnapshotId: latest.id,
          previousSnapshotId: previous.id,
        },
        evidences: [
          {
            evidenceType: 'metric_snapshot',
            sourceType: 'tenant_metric_snapshot',
            sourceId: latest.id,
            excerpt: `Snapshot atual ${metricKey}: ${latest.value}.`,
            structuredData: {
              metricKey,
              latest: latestValue,
              previous: previousValue,
              changeRatio,
              snapshots: [latest.id, previous.id],
            },
          },
        ],
      });
    }

    const topTypeMetric = snapshotsByMetric.get('event_ledger.top_type_ratio')?.[0] || null;
    if (topTypeMetric) {
      const ratio = toNumber(topTypeMetric.value, 0);
      const totalEvents = toNumber(topTypeMetric.metadata?.total, 0);
      if (ratio >= 0.6 && totalEvents >= 20) {
        const topType = topTypeMetric.metadata?.topType || 'unknown';
        candidates.push({
          type: 'event_concentration',
          title: `Concentracao de eventos em ${topType}`,
          description: `Foi detectada concentracao de ${Math.round(ratio * 100)}% dos eventos no padrao ${topType}.`,
          confidence: 0.8,
          impact: ratio >= 0.75 ? 'high' : 'medium',
          source: 'metric_engine',
          relatedMetrics: ['event_ledger.top_type_ratio'],
          metadata: {
            topType,
            ratio,
            totalEvents,
            metricSnapshotId: topTypeMetric.id,
          },
          evidences: [
            {
              evidenceType: 'event_pattern',
              sourceType: 'tenant_metric_snapshot',
              sourceId: topTypeMetric.id,
              excerpt: `Padrao ${topType} representa ${Math.round(ratio * 100)}% dos eventos.`,
              structuredData: {
                topType,
                ratio,
                totalEvents,
              },
            },
          ],
        });
      }
    }

    if (!persist) {
      return {
        ok: true,
        created: 0,
        skipped: 0,
        insights: candidates,
      };
    }

    const createdInsights = [];
    let skipped = 0;

    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await this._findExistingInsight({
        tenantId,
        type: candidate.type,
        title: candidate.title,
        periodStart: periodBounds.start,
        periodEnd: periodBounds.end,
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const created = await this._createInsightWithEvidence({
        tenantId,
        candidate,
        periodStart: periodBounds.start,
        periodEnd: periodBounds.end,
      });
      createdInsights.push(created);
    }

    return {
      ok: true,
      created: createdInsights.length,
      skipped,
      insights: createdInsights,
    };
  }

  _normalizeSnapshots(snapshots) {
    if (!Array.isArray(snapshots)) return [];
    return snapshots
      .map((item) => (item && typeof item.toJSON === 'function' ? item.toJSON() : item))
      .filter((item) => item && typeof item === 'object' && item.metric_key);
  }

  _groupSnapshotsByMetric(snapshots = []) {
    const grouped = new Map();

    for (const snapshot of snapshots) {
      const metricKey = String(snapshot.metric_key || 'unknown');
      if (!grouped.has(metricKey)) grouped.set(metricKey, []);
      grouped.get(metricKey).push(snapshot);
    }

    for (const [metricKey, list] of grouped.entries()) {
      const ordered = list
        .slice()
        .sort((a, b) => this._snapshotSortValue(b) - this._snapshotSortValue(a))
        .slice(0, 3);
      grouped.set(metricKey, ordered);
    }

    return grouped;
  }

  _snapshotSortValue(snapshot) {
    const periodEndTs = new Date(snapshot?.period_end || 0).getTime();
    if (Number.isFinite(periodEndTs) && periodEndTs > 0) return periodEndTs;

    const createdAtTs = new Date(snapshot?.created_at || 0).getTime();
    if (Number.isFinite(createdAtTs) && createdAtTs > 0) return createdAtTs;

    return 0;
  }

  async _loadRecentSnapshotsByMetric({ tenantId, periodStart, periodEnd } = {}) {
    const SnapshotModel = TenantMetricSnapshot();
    const rows = await SnapshotModel.findAll({
      where: {
        tenant_key: String(tenantId),
        period_start: { [Op.gte]: periodStart },
        period_end: { [Op.lte]: periodEnd },
      },
      order: [['metric_key', 'ASC'], ['period_end', 'DESC'], ['created_at', 'DESC']],
      limit: 1000,
    });

    const grouped = new Map();
    for (const row of rows || []) {
      const item = row.toJSON ? row.toJSON() : row;
      const key = String(item.metric_key || 'unknown');
      if (!grouped.has(key)) grouped.set(key, []);
      const list = grouped.get(key);
      if (list.length < 3) list.push(item);
    }

    return grouped;
  }

  async _findExistingInsight({ tenantId, type, title, periodStart, periodEnd } = {}) {
    const InsightModel = TenantInsight();
    const row = await InsightModel.findOne({
      where: {
        tenant_key: String(tenantId),
        type: String(type),
        title: String(title),
        period_start: periodStart,
        period_end: periodEnd,
        status: 'open',
      },
    });

    return row ? (row.toJSON ? row.toJSON() : row) : null;
  }

  async _createInsightWithEvidence({ tenantId, candidate, periodStart, periodEnd } = {}) {
    const InsightModel = TenantInsight();
    const row = await InsightModel.create({
      id: buildId('insight'),
      tenant_key: String(tenantId),
      type: String(candidate.type),
      title: String(candidate.title),
      description: String(candidate.description),
      confidence: Number(candidate.confidence || 0.5),
      impact: String(candidate.impact || 'medium'),
      status: 'open',
      period_start: periodStart,
      period_end: periodEnd,
      source: String(candidate.source || 'tenant_intelligence'),
      related_metrics: Array.isArray(candidate.relatedMetrics) ? candidate.relatedMetrics : [],
      metadata: candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {},
    });

    const insight = row.toJSON ? row.toJSON() : row;
    const evidences = [];

    for (const evidence of candidate.evidences || []) {
      // eslint-disable-next-line no-await-in-loop
      const created = await this.evidenceEngine.createEvidence({
        tenantId,
        insightId: insight.id,
        evidenceType: evidence.evidenceType,
        sourceType: evidence.sourceType,
        sourceId: evidence.sourceId,
        excerpt: evidence.excerpt,
        structuredData: evidence.structuredData,
        metadata: evidence.metadata || {},
      });
      evidences.push(created);
    }

    return {
      ...insight,
      evidences,
    };
  }
}

module.exports = {
  InsightEngine,
};

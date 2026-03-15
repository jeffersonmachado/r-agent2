'use strict';

const ragService = require('../../services/ragService');
const { ContextResolver } = require('./ContextResolver');
const { GoalEngine } = require('./GoalEngine');
const { MetricEngine } = require('./MetricEngine');
const { InsightEngine } = require('./InsightEngine');
const { RecommendationEngine } = require('./RecommendationEngine');
const { EvidenceEngine } = require('./EvidenceEngine');

class StrategicSearchService {
  constructor({
    contextResolver,
    goalEngine,
    metricEngine,
    insightEngine,
    recommendationEngine,
    evidenceEngine,
    rag,
  } = {}) {
    this.contextResolver = contextResolver || new ContextResolver();
    this.goalEngine = goalEngine || new GoalEngine();
    this.metricEngine = metricEngine || new MetricEngine();
    this.insightEngine = insightEngine || new InsightEngine({
      goalEngine: this.goalEngine,
      metricEngine: this.metricEngine,
    });
    this.recommendationEngine = recommendationEngine || new RecommendationEngine();
    this.evidenceEngine = evidenceEngine || new EvidenceEngine();
    this.rag = rag || ragService;
  }

  async search({ tenantId, question, period = 'month', filters = {}, options = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const effectiveOptions = {
      refreshMetrics: false,
      refreshInsights: false,
      refreshRecommendations: false,
      mode: 'read',
      ...(options && typeof options === 'object' ? options : {}),
    };

    const mode = String(effectiveOptions.mode || 'read').toLowerCase();
    const shouldRefreshMetrics = !!effectiveOptions.refreshMetrics;
    const shouldRefreshInsights = !!effectiveOptions.refreshInsights;
    const shouldRefreshRecommendations = !!effectiveOptions.refreshRecommendations;

    const context = await this.contextResolver.resolve({ tenantId, period, filters });

    const goalsResult = await this.goalEngine.listGoals({
      tenantId,
      status: 'active',
      includeComputed: true,
      limit: 200,
    });

    let snapshotsResult = {
      ok: true,
      snapshots: [],
      skipped: true,
      reason: 'refreshMetrics_disabled',
    };

    if (shouldRefreshMetrics) {
      snapshotsResult = await this.metricEngine.collectSnapshots({ tenantId, period, filters });
    }

    const metricsResult = await this.metricEngine.listSnapshots({ tenantId, period, limit: 200 });

    let generatedInsights = {
      ok: true,
      created: 0,
      skipped: 0,
      insights: [],
      reason: 'refreshInsights_disabled',
    };

    if (shouldRefreshInsights) {
      generatedInsights = await this.insightEngine.generateInsights({
        tenantId,
        period,
        filters,
        persist: true,
        snapshots: snapshotsResult?.ok ? snapshotsResult.snapshots : null,
        refreshMetrics: false,
      });
    }

    const insightsResult = await this.insightEngine.listInsights({
      tenantId,
      status: 'open',
      limit: 200,
    });

    let generatedRecommendations = {
      ok: true,
      created: 0,
      recommendations: [],
      reason: 'refreshRecommendations_disabled',
    };

    if (shouldRefreshRecommendations) {
      generatedRecommendations = await this.recommendationEngine.generateRecommendations({
        tenantId,
        insights: insightsResult.items,
        goals: goalsResult.items,
      });
    }

    const recommendationsResult = await this.recommendationEngine.listRecommendations({
      tenantId,
      status: 'open',
      limit: 200,
    });

    let ragResult = null;
    if (question && String(question).trim()) {
      try {
        ragResult = await this.rag.queryRag(
          String(question).trim(),
          String(tenantId),
          {
            strategic: true,
            period,
            filters,
          },
          filters || {}
        );
      } catch (err) {
        ragResult = {
          success: false,
          error: err?.message || 'rag_query_failed',
        };
      }
    }

    const topInsights = (insightsResult.items || []).slice(0, 10).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      confidence: item.confidence,
      impact: item.impact,
      related_metrics: item.related_metrics,
      status: item.status,
    }));

    const topRecommendations = (recommendationsResult.items || []).slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      action_type: item.action_type,
      priority: item.priority,
      insight_id: item.insight_id,
      goal_id: item.goal_id,
    }));

    const topInsightIds = topInsights.slice(0, 5).map((i) => i.id).filter(Boolean);
    const evidenceItems = topInsightIds.length > 0
      ? (await Promise.all(
          topInsightIds.map((insightId) =>
            this.evidenceEngine.listByInsight({ tenantId, insightId, limit: 5 })
              .then((r) => r.items || [])
              .catch(() => []),
          ),
        )).flat()
      : [];

    const ragSources = Array.isArray(ragResult?.sources)
      ? ragResult.sources.map((source) => ({
          documentId: source.documentId || source.document_id || null,
          chunkId: source.chunkId || source.chunk_id || null,
          score: source.score || null,
        }))
      : [];

    const answerText = (ragResult?.success && ragResult?.response)
      ? String(ragResult.response)
      : this._buildTextAnswer({ context, goals: goalsResult.items || [], insights: topInsights });

    return {
      ok: true,
      answer: answerText,
      context: {
        tenant: context.tenantContext || {},
        objectives: (goalsResult.items || []).map((g) => ({
          id: g.id,
          name: g.name,
          metric_key: g.metric_key,
          target_value: g.target_value,
          current_value: g.current_value,
          status: g.computed?.computedStatus || 'unknown',
        })),
        period: context.period || {},
        filters: filters || {},
      },
      goalsImpact: (goalsResult.items || []).map((goal) => ({
        id: goal.id,
        name: goal.name,
        metric_key: goal.metric_key,
        target_value: goal.target_value,
        current_value: goal.current_value,
        status: goal.computed?.computedStatus || 'unknown',
        progress_percent: goal.computed?.progressPercent ?? null,
        delta: goal.computed?.delta ?? null,
      })),
      insights: topInsights,
      recommendations: topRecommendations,
      evidence: evidenceItems,
      sources: ragSources,
      meta: {
        usedRag: !!ragResult?.success,
        ragConfidence: ragResult?.confidence || 0,
        usedSnapshots: shouldRefreshMetrics && !!(snapshotsResult?.ok),
        usedPersistedInsights: true,
        mode,
      },
    };
  }

  _buildTextAnswer({ context, goals, insights } = {}) {
    const goalCount = Array.isArray(goals) ? goals.length : 0;
    const offTrack = (goals || []).filter((g) => g?.computed?.computedStatus === 'off_track').length;
    const tenantObj = context?.tenantContext?.objetivo;
    const parts = [];
    if (tenantObj) parts.push(`Objetivo principal: ${tenantObj}.`);
    parts.push(`${goalCount} meta(s) ativa(s)${offTrack > 0 ? `, ${offTrack} fora do esperado` : ''}.`);
    if (Array.isArray(insights) && insights.length > 0) {
      const titles = insights.slice(0, 3).map((i) => i.title || i.type).filter(Boolean);
      if (titles.length > 0) parts.push(`Principais insights: ${titles.join('; ')}.`);
    }
    return parts.join(' ') || 'Analise estrategica concluida.';
  }
}

module.exports = {
  StrategicSearchService,
};

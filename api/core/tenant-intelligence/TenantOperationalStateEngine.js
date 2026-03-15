'use strict';

const { ContextResolver } = require('./ContextResolver');
const { GoalEngine } = require('./GoalEngine');
const { MetricEngine } = require('./MetricEngine');
const { InsightEngine } = require('./InsightEngine');
const { RecommendationEngine } = require('./RecommendationEngine');
const { EvidenceEngine } = require('./EvidenceEngine');
const { MarketKnowledgeService } = require('../market-intelligence/MarketKnowledgeService');

class TenantOperationalStateEngine {
  constructor({
    contextResolver,
    goalEngine,
    metricEngine,
    insightEngine,
    recommendationEngine,
    evidenceEngine,
    marketKnowledgeService,
  } = {}) {
    this.contextResolver = contextResolver || new ContextResolver();
    this.goalEngine = goalEngine || new GoalEngine();
    this.metricEngine = metricEngine || new MetricEngine();
    this.insightEngine = insightEngine || new InsightEngine({
      goalEngine: this.goalEngine,
      metricEngine: this.metricEngine,
      evidenceEngine,
    });
    this.recommendationEngine = recommendationEngine || new RecommendationEngine();
    this.evidenceEngine = evidenceEngine || new EvidenceEngine();
    this.marketKnowledgeService = marketKnowledgeService || new MarketKnowledgeService();
  }

  async getOperationalState({ tenantId, period = 'month', filters = {}, options = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const effectiveOptions = {
      refreshMetrics: false,
      includeEvidence: false,
      goalLimit: 200,
      snapshotLimit: 200,
      insightLimit: 50,
      recommendationLimit: 50,
      ...(options && typeof options === 'object' ? options : {}),
    };

    const shouldRefreshMetrics = !!effectiveOptions.refreshMetrics;
    const includeEvidence = !!effectiveOptions.includeEvidence;

    let refreshResult = {
      ok: true,
      skipped: true,
      snapshots: [],
      reason: 'refreshMetrics_disabled',
    };

    if (shouldRefreshMetrics) {
      refreshResult = await this.metricEngine.collectSnapshots({
        tenantId,
        period,
        filters,
      });
    }

    const [context, goalsResult, metricsResult, insightsResult, recommendationsResult] = await Promise.all([
      this.contextResolver.resolve({ tenantId, period, filters }),
      this.goalEngine.listGoals({
        tenantId,
        status: 'active',
        includeComputed: true,
        limit: Math.min(Math.max(Number(effectiveOptions.goalLimit) || 200, 1), 500),
      }),
      this.metricEngine.listSnapshots({
        tenantId,
        period,
        limit: Math.min(Math.max(Number(effectiveOptions.snapshotLimit) || 200, 1), 500),
      }),
      this.insightEngine.listInsights({
        tenantId,
        status: 'open',
        limit: Math.min(Math.max(Number(effectiveOptions.insightLimit) || 50, 1), 500),
      }),
      this.recommendationEngine.listRecommendations({
        tenantId,
        status: 'open',
        limit: Math.min(Math.max(Number(effectiveOptions.recommendationLimit) || 50, 1), 500),
      }),
    ]);

    const marketSignals = await this.marketKnowledgeService.getOperationalSignals(tenantId, {
      metricKeys: metricsResult?.items?.map((item) => item.metric_key).filter(Boolean),
      vertical: context?.strategicProfile?.ramoAtividade || context?.tenantContext?.ramo_atividade || undefined,
    }).catch(() => ({
      ok: false,
      vertical: 'global',
      benchmarks: [],
      patterns: [],
      playbooks: [],
      recommendations: [],
    }));

    const goals = Array.isArray(goalsResult?.items) ? goalsResult.items : [];
    const metrics = Array.isArray(metricsResult?.items) ? metricsResult.items : [];
    const insights = Array.isArray(insightsResult?.items) ? insightsResult.items : [];
    const recommendations = Array.isArray(recommendationsResult?.items) ? recommendationsResult.items : [];

    const evidenceByInsight = {};
    let evidenceTotal = 0;

    if (includeEvidence && insights.length > 0 && this.evidenceEngine?.listByInsight) {
      const insightIds = insights.slice(0, 10).map((i) => i.id).filter(Boolean);
      const evidenceChunks = await Promise.all(
        insightIds.map((insightId) =>
          this.evidenceEngine.listByInsight({ tenantId, insightId, limit: 10 })
            .then((result) => ({ insightId, items: result?.items || [] }))
            .catch(() => ({ insightId, items: [] })),
        ),
      );

      for (const chunk of evidenceChunks) {
        evidenceByInsight[chunk.insightId] = chunk.items;
        evidenceTotal += chunk.items.length;
      }
    }

    const goalStatusCounts = this._countBy(goals, (goal) => goal?.computed?.computedStatus || 'unknown');
    const insightImpactCounts = this._countBy(insights, (insight) => insight?.impact || 'unknown');
    const recommendationPriorityCounts = this._countBy(recommendations, (rec) => rec?.priority || 'unknown');

    const latestSnapshotAt = metrics
      .map((snapshot) => snapshot?.period_end || snapshot?.created_at || null)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    const health = this._computeHealth({
      goalStatusCounts,
      insightImpactCounts,
      recommendationPriorityCounts,
      marketSignals,
    });

    const marketDerived = this._buildMarketDerivedState(marketSignals);

    return {
      ok: true,
      state: {
        tenant: {
          id: String(tenantId),
          context: context?.tenantContext || {},
        },
        period: context?.period || {},
        filters: filters || {},
        health,
        goals: {
          total: goals.length,
          byStatus: goalStatusCounts,
          items: goals,
        },
        metrics: {
          totalSnapshots: metrics.length,
          latestSnapshotAt,
          items: metrics,
        },
        insights: {
          totalOpen: insights.length,
          byImpact: insightImpactCounts,
          items: insights,
          evidenceByInsight,
          evidenceTotal,
        },
        recommendations: {
          totalOpen: recommendations.length,
          byPriority: recommendationPriorityCounts,
          items: recommendations,
        },
        market: {
          ok: marketSignals?.ok !== false,
          vertical: marketSignals?.vertical || 'global',
          benchmarks: marketSignals?.benchmarks || [],
          patterns: marketSignals?.patterns || [],
          playbooks: marketSignals?.playbooks || [],
          recommendations: marketSignals?.recommendations || [],
        },
        risks: marketDerived.risks,
        opportunities: marketDerived.opportunities,
        priorities: marketDerived.priorities,
        refresh: {
          metrics: shouldRefreshMetrics,
          snapshotsCreated: Array.isArray(refreshResult?.snapshots) ? refreshResult.snapshots.length : 0,
          ok: refreshResult?.ok !== false,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  }

  _countBy(items, getKey) {
    const counts = {};
    for (const item of items || []) {
      const key = String(getKey(item) || 'unknown');
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  _computeHealth({
    goalStatusCounts = {},
    insightImpactCounts = {},
    recommendationPriorityCounts = {},
    marketSignals = {},
  } = {}) {
    const offTrack = Number(goalStatusCounts.off_track || 0);
    const atRisk = Number(goalStatusCounts.at_risk || 0);
    const highImpactInsights = Number(insightImpactCounts.high || 0);
    const criticalRecommendations = Number(recommendationPriorityCounts.critical || 0);
    const marketRisks = Array.isArray(marketSignals?.recommendations)
      ? marketSignals.recommendations.filter((item) => item?.recommendation_type === 'risk_mitigation').length
      : 0;

    let score = 100;
    score -= offTrack * 20;
    score -= atRisk * 10;
    score -= highImpactInsights * 15;
    score -= criticalRecommendations * 10;
    score -= marketRisks * 8;
    score = Math.max(0, Math.min(100, score));

    let status = 'healthy';
    if (score <= 39) status = 'critical';
    else if (score <= 69) status = 'warning';

    const reasons = [];
    if (offTrack > 0) reasons.push(`${offTrack} goal(s) off_track`);
    if (atRisk > 0) reasons.push(`${atRisk} goal(s) at_risk`);
    if (highImpactInsights > 0) reasons.push(`${highImpactInsights} high-impact insight(s)`);
    if (criticalRecommendations > 0) reasons.push(`${criticalRecommendations} critical recommendation(s)`);
    if (marketRisks > 0) reasons.push(`${marketRisks} market risk signal(s)`);

    return {
      status,
      score,
      reasons,
    };
  }

  _buildMarketDerivedState(marketSignals = {}) {
    const risks = [];
    const opportunities = [];
    const priorities = [];

    for (const benchmark of marketSignals?.benchmarks || []) {
      const metricKey = String(benchmark.metricKey || benchmark.metric || benchmark.metric_key || '');
      const status = String(benchmark.status || '');
      if (!metricKey || !status) continue;

      if (status === 'above_market' && (metricKey.includes('cancel') || metricKey.includes('no_show') || metricKey.includes('churn'))) {
        risks.push({
          type: `above_market_${metricKey.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
          metric_key: metricKey,
          tenant_value: benchmark.tenantValue || benchmark.tenant_value,
          market_avg: benchmark.marketAvg || benchmark.market_avg,
          percentile: benchmark.percentile,
        });
      }

      if (status === 'below_market' && (metricKey.includes('conversion') || metricKey.includes('revenue'))) {
        opportunities.push({
          type: `below_market_${metricKey.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
          metric_key: metricKey,
          tenant_value: benchmark.tenantValue || benchmark.tenant_value,
          market_avg: benchmark.marketAvg || benchmark.market_avg,
          percentile: benchmark.percentile,
        });
      }
    }

    for (const recommendation of marketSignals?.recommendations || []) {
      priorities.push({
        type: recommendation?.recommendation_type || 'market_action',
        metric_key: recommendation?.metric_key || null,
        problem_type: recommendation?.problem_type || null,
        playbooks: Array.isArray(recommendation?.playbooks) ? recommendation.playbooks.length : 0,
      });
    }

    return { risks, opportunities, priorities };
  }
}

module.exports = {
  TenantOperationalStateEngine,
};

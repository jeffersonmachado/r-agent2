'use strict';

const predictiveInsightsService = require('../autonomous-scheduling/PredictiveInsightsService');
const revenueEngine = require('../revenue/RevenueEngine');
const recommendationEngine = require('./RecommendationEngine');
const snapshotService = require('../autonomous-scheduling/OperationalMetricSnapshotService');

async function getDashboard({ tenantId, verticalTemplate = null, serviceType = null }) {
  const [predictive, opportunities, recommendations, snapshots] = await Promise.all([
    predictiveInsightsService.getInsights({ tenantId, verticalTemplate, serviceType }),
    revenueEngine.listOpportunities({ tenantId }),
    recommendationEngine.listRecommendations({ tenantId, serviceType }),
    snapshotService.listSnapshots({ tenantId, serviceType, limit: 5 }),
  ]);

  return {
    ok: true,
    dashboard: {
      predictive: predictive.insights,
      opportunities: opportunities.items || [],
      recommendations: recommendations.items || [],
      snapshots: snapshots.items || [],
    },
  };
}

module.exports = {
  getDashboard,
};

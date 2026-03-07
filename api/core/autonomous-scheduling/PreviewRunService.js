'use strict';

const logger = require('../../utils/logger');
const { getRuntime } = require('./AutonomousRuntimeService');
const { getPolicy } = require('./AutonomousSchedulePolicyService');
const gapDetectionService = require('./GapDetectionService');
const campaignService = require('./AutonomousCampaignService');
const recommendationEngine = require('../insights/RecommendationEngine');
const revenueEngine = require('../revenue/RevenueEngine');
const { isWithinQuietHours, structuredReason } = require('./runtime');

async function previewRun({ tenantId, ownerId = null, teamId = null, serviceType = null, contextType = null, contextId = null }) {
  const [runtimeOut, policy] = await Promise.all([
    getRuntime(tenantId),
    getPolicy(tenantId),
  ]);
  const runtime = runtimeOut.runtime || {};
  const quietHoursActive = isWithinQuietHours(runtime);
  const gapsOut = await gapDetectionService.detectOpenGaps({
    tenantId,
    ownerId,
    teamId,
    serviceType: serviceType || policy?.settings?.serviceType || null,
    now: new Date(),
  });
  const campaignsOut = await campaignService.listCampaigns({
    tenantId,
    limit: '20',
    statuses: ['open', 'running'],
  });
  const [recommendationsOut, revenueOut] = await Promise.all([
    recommendationEngine.listRecommendations({ tenantId, serviceType }),
    runtime.revenueEnabled ? revenueEngine.listOpportunities({ tenantId }) : Promise.resolve({ ok: true, items: [] }),
  ]);

  logger.info('[AutonomousScheduling] preview run generated', {
    tenantId,
    quietHoursActive,
    gaps: gapsOut.items?.length || 0,
    campaigns: campaignsOut.items?.length || 0,
    recommendations: recommendationsOut.items?.length || 0,
    revenueOpportunities: revenueOut.items?.length || 0,
  });

  return {
    ok: true,
    preview: {
      runtime,
      simulationMode: runtime.simulationMode !== false,
      quietHoursActive,
      wouldExecuteRealActions: false,
      reasons: [
        structuredReason('simulation_mode', 'Preview run calcula efeitos sem disparar ações reais.', { severity: 'info' }),
        ...(quietHoursActive ? [structuredReason('runtime_disabled', 'Quiet hours ativas; apenas preview é recomendado.', { severity: 'warning' })] : []),
      ],
      eligibleGaps: gapsOut.items || [],
      eligibleCampaigns: campaignsOut.items || [],
      recommendations: recommendationsOut.items || [],
      revenueOpportunities: revenueOut.items || [],
      context: { ownerId, teamId, serviceType, contextType, contextId },
    },
  };
}

module.exports = {
  previewRun,
};

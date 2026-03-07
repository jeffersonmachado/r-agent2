'use strict';

const { AutonomousGapCampaign, KioskSession } = require('../../db/models');
const { getJson } = require('../autonomous-scheduling/shared');
const { getRuntime } = require('../autonomous-scheduling/AutonomousRuntimeService');
const { getPolicy } = require('../autonomous-scheduling/AutonomousSchedulePolicyService');
const { getAggregatedMetrics } = require('../autonomous-scheduling/OperationalMetricsAggregator');
const { getInsights } = require('../autonomous-scheduling/PredictiveInsightsService');
const snapshotService = require('../autonomous-scheduling/OperationalMetricSnapshotService');
const revenueEngine = require('../revenue/RevenueEngine');
const { getPreset } = require('../autonomous-scheduling/VerticalTemplateRegistry');
const { structuredReason, isWithinQuietHours } = require('../autonomous-scheduling/runtime');

function recommendation(type, severity, title, message, recommendedAction, metadata = {}, confidence = 0.5, relatedEntityType = null, relatedEntityId = null, reasons = []) {
  return {
    type,
    severity,
    title,
    message,
    recommendedAction,
    metadata,
    confidence: Number(confidence.toFixed(3)),
    relatedEntityType,
    relatedEntityId,
    reasons,
    reasonCodes: reasons.map((item) => item.code).filter(Boolean),
  };
}

async function listRecommendations({ tenantId, serviceType = null, relatedEntityType = null, relatedEntityId = null }) {
  const [runtimeOut, policy, metricsOut, snapshotsOut, predictiveOut, revenueOut, campaignRows, kioskRows] = await Promise.all([
    getRuntime(tenantId),
    getPolicy(tenantId),
    getAggregatedMetrics({ tenantId, serviceType }),
    snapshotService.listSnapshots({ tenantId, serviceType, limit: 12 }),
    getInsights({ tenantId, serviceType }),
    revenueEngine.listOpportunities({ tenantId }),
    AutonomousGapCampaign().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 20 }),
    KioskSession().findAll({ where: { tenant_key: String(tenantId) }, order: [['created_at', 'DESC']], limit: 20 }),
  ]);

  const runtime = runtimeOut.runtime || {};
  if (!runtime.recommendationsEnabled) {
    return {
      ok: true,
      disabled: true,
      reasons: [structuredReason('runtime_disabled', 'Recommendation engine desabilitado no runtime.', { severity: 'warning' })],
      items: [],
    };
  }

  const preset = getPreset(policy?.settings?.verticalTemplate || 'beauty');
  const predictive = predictiveOut.insights || {};
  const metrics = metricsOut.items || [];
  const snapshots = snapshotsOut.items || [];
  const campaigns = campaignRows.map(getJson);
  const kioskSessions = kioskRows.map(getJson);
  const items = [];

  if (predictive.idleRisk === 'high') {
    items.push(recommendation(
      'preventive_campaign',
      'warning',
      'Rodar campanha preventiva',
      'Há risco alto de ociosidade para os gaps monitorados.',
      'Executar preview run e revisar waiting list antes de abrir campanha manual.',
      { verticalTemplate: predictive.verticalTemplate, serviceType: predictive.serviceType },
      Math.max(0.6, predictive.fillProbability || 0.5),
      'runtime',
      runtime.id || null,
      predictive.reasons || [structuredReason('high_idle_risk', 'Métricas apontam baixa eficiência de fill.', { severity: 'warning' })],
    ));
  }

  if (predictive.noShowRisk === 'high') {
    items.push(recommendation(
      'high_no_show_followup',
      'warning',
      'Reforçar confirmação e follow-up',
      'O risco de no-show está elevado para a operação atual.',
      'Aumentar confirmações e monitorar candidatos com menor taxa de resposta.',
      { serviceType: predictive.serviceType },
      0.68,
      'predictive_insight',
      predictive.serviceType || null,
      predictive.reasons || [structuredReason('high_no_show_risk', 'Risco alto de ausência detectado.', { severity: 'warning' })],
    ));
  }

  const openCampaign = campaigns.find((item) => ['open', 'running'].includes(String(item.status || '').toLowerCase()));
  if (openCampaign && (metrics[0]?.fillRate || 0) < 60) {
    items.push(recommendation(
      'fill_priority_gap',
      'critical',
      'Gap com prioridade de preenchimento',
      'Existe campanha aberta com fill rate abaixo do esperado.',
      'Priorizar candidatos com score breakdown forte e revisar política de convites.',
      { campaignId: openCampaign.id, gapStartAt: openCampaign.gap_start_at || openCampaign.gapStartAt },
      0.79,
      'campaign',
      openCampaign.id,
      [structuredReason('high_idle_risk', 'Campanha aberta ainda sem preenchimento ideal.', { severity: 'critical' })],
    ));
  }

  for (const opportunity of (revenueOut.items || []).slice(0, 3)) {
    const type = String(opportunity.type || '').toLowerCase() === 'reactivation' ? 'reactivation_campaign' : 'upsell_opportunity';
    items.push(recommendation(
      type,
      'info',
      type === 'reactivation_campaign' ? 'Reativação sugerida' : 'Upsell sugerido',
      `Oportunidade de receita aberta do tipo ${opportunity.type}.`,
      'Revisar oportunidade e decidir ação manual com CRM/Support.',
      { opportunityId: opportunity.id, serviceType: opportunity.service_type || null },
      Number(opportunity.confidence || 0.4),
      'revenue_opportunity',
      opportunity.id,
      opportunity.reasons || [structuredReason('revenue_recovery', 'Oportunidade de receita priorizada.', { severity: 'info' })],
    ));
  }

  if (runtime.safetyMode === 'manual' || runtime.autoCampaignEnabled) {
    items.push(recommendation(
      'runtime_safety_warning',
      runtime.autoCampaignEnabled ? 'critical' : 'info',
      'Revisar governança do runtime',
      runtime.autoCampaignEnabled
        ? 'Campanhas automáticas estão habilitadas fora do modo recomendado para esta fase.'
        : 'O runtime permanece conservador e pronto para automação futura sem ativação real.',
      'Usar preview run e snapshots antes de habilitar automações recorrentes.',
      { safetyMode: runtime.safetyMode, simulationMode: runtime.simulationMode },
      0.85,
      'runtime',
      runtime.id || null,
      [structuredReason(runtime.autoCampaignEnabled ? 'runtime_disabled' : 'simulation_mode', 'Runtime requer revisão operacional.', { severity: runtime.autoCampaignEnabled ? 'critical' : 'info' })],
    ));
  }

  const recentKioskOpen = kioskSessions.filter((item) => String(item.status || '').toLowerCase() === 'open').length;
  if (runtime.kioskEnabled && recentKioskOpen > 0) {
    items.push(recommendation(
      'kiosk_opportunity',
      'info',
      'Há oportunidade operacional no kiosk',
      'Sessões recentes de kiosk indicam demanda que pode ser convertida em encaixes ou handoff.',
      'Revisar sessões recentes e disponibilidade para encaixe imediato.',
      { kioskSessionsOpen: recentKioskOpen },
      0.56,
      'kiosk_session',
      kioskSessions[0]?.id || null,
      [structuredReason('kiosk_checkin_gap', 'Canal kiosk ativo com potencial de conversão.', { severity: 'info' })],
    ));
  }

  if (isWithinQuietHours(runtime)) {
    items.push(recommendation(
      'runtime_safety_warning',
      'warning',
      'Quiet hours ativas',
      'O tenant está em quiet hours; ações reais devem continuar manuais.',
      'Rodar apenas preview durante a janela silenciosa.',
      { quietHoursStart: runtime.quietHoursStart, quietHoursEnd: runtime.quietHoursEnd },
      0.9,
      'runtime',
      runtime.id || null,
      [structuredReason('runtime_disabled', 'Quiet hours bloqueiam ação operacional direta.', { severity: 'warning' })],
    ));
  }

  const filtered = items
    .filter((item) => !relatedEntityType || item.relatedEntityType === relatedEntityType)
    .filter((item) => !relatedEntityId || String(item.relatedEntityId || '') === String(relatedEntityId))
    .slice(0, Math.max(0, Number(runtime.maxRecommendationsPerRun || preset.runtimeDefaults?.maxRecommendationsPerRun || 10)));

  return { ok: true, items: filtered };
}

module.exports = {
  listRecommendations,
};

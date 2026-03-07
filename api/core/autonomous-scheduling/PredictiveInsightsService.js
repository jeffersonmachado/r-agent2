'use strict';

const { getPolicy } = require('./AutonomousSchedulePolicyService');
const { getRuntime } = require('./AutonomousRuntimeService');
const { getAggregatedMetrics } = require('./OperationalMetricsAggregator');
const { getPreset } = require('./VerticalTemplateRegistry');
const { structuredReason } = require('./runtime');

function classifyRisk(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function normalizeScore(value) {
  return Number(Math.max(0, Math.min(1, value || 0)).toFixed(3));
}

function buildReasons({ idleRiskScore, noShowRiskScore, fillProbability, baseline, runtime }) {
  const reasons = [];
  if (!runtime?.predictiveEnabled) {
    reasons.push(structuredReason('runtime_disabled', 'Predictive insights desabilitado no runtime.', { severity: 'warning' }));
  }
  if ((baseline?.fillRate || 0) < 55) {
    reasons.push(structuredReason('high_idle_risk', 'Fill rate abaixo do esperado para esta combinação.', { severity: 'warning', metric: 'fill_rate', value: baseline?.fillRate || 0 }));
  }
  if ((baseline?.noShowRate || 0) >= 20 || (baseline?.expirationRate || 0) >= 35) {
    reasons.push(structuredReason('high_no_show_risk', 'No-show ou expiração estão elevados.', { severity: 'warning', metric: 'no_show_rate', value: baseline?.noShowRate || baseline?.expirationRate || 0 }));
  }
  if (fillProbability >= 0.7) {
    reasons.push(structuredReason('service_affinity', 'Há boa probabilidade de preenchimento com os dados atuais.', { severity: 'info', metric: 'fill_probability', value: fillProbability }));
  }
  if (runtime?.simulationMode) {
    reasons.push(structuredReason('simulation_mode', 'O runtime está em modo de simulação para futuras automações.', { severity: 'info' }));
  }
  if (idleRiskScore >= 0.7 && !runtime?.autoDetectEnabled) {
    reasons.push(structuredReason('runtime_disabled', 'Risco alto de ociosidade, mas detecção automática permanece desligada.', { severity: 'warning' }));
  }
  return reasons;
}

async function getInsights({ tenantId, verticalTemplate = null, serviceType = null, metricsOverride = null, runtimeOverride = null }) {
  const [policyOut, runtimeOut, metricsOut] = await Promise.all([
    getPolicy(tenantId),
    runtimeOverride ? Promise.resolve({ runtime: runtimeOverride }) : getRuntime(tenantId),
    metricsOverride ? Promise.resolve({ items: [metricsOverride] }) : getAggregatedMetrics({ tenantId, verticalTemplate, serviceType }),
  ]);
  const template = verticalTemplate || policyOut?.settings?.verticalTemplate || 'beauty';
  const preset = getPreset(template);
  const baseline = metricsOverride || metricsOut.items?.[0] || {
    fillRate: 0,
    acceptRate: 0,
    expirationRate: 0,
    noShowRate: 0,
    campaignsOpen: 0,
  };
  const runtime = runtimeOverride || runtimeOut.runtime;

  const idleRiskScore = normalizeScore(((100 - (baseline.fillRate || 0)) / 100) * 0.7 + ((baseline.campaignsOpen || 0) > (runtime.maxCampaignsPerRun || 1) ? 0.3 : 0.1));
  const noShowRiskScore = normalizeScore(((baseline.noShowRate || baseline.expirationRate || 0) / 100));
  const fillProbability = normalizeScore(((baseline.fillRate || 0) / 100) * 0.65 + ((baseline.acceptRate || 0) / 100) * 0.35);
  const reasons = buildReasons({ idleRiskScore, noShowRiskScore, fillProbability, baseline, runtime });

  return {
    ok: true,
    insights: {
      verticalTemplate: template,
      serviceType: serviceType || baseline.serviceType || null,
      idleRisk: classifyRisk(idleRiskScore),
      idleRiskScore,
      noShowRisk: classifyRisk(noShowRiskScore),
      noShowRiskScore,
      fillProbability,
      recommendedAction: idleRiskScore >= 0.7
        ? 'consider_manual_gap_detection'
        : (noShowRiskScore >= 0.7 ? 'reinforce_confirmation' : 'monitor'),
      reasonCodes: reasons.map((item) => item.code),
      reasons,
      thresholds: preset.predictiveThresholds || {},
      runtime,
      policy: {
        enabled: policyOut.enabled,
        channel: policyOut.channel,
        sendWindowStart: policyOut.sendWindowStart,
        sendWindowEnd: policyOut.sendWindowEnd,
      },
      metrics: baseline,
    },
  };
}

module.exports = {
  getInsights,
};

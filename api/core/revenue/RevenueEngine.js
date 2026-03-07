'use strict';

const { CrmContact, RevenueOpportunity, AutonomousGapCampaign } = require('../../db/models');
const { newId, getJson } = require('../autonomous-scheduling/shared');
const { getAggregatedMetrics } = require('../autonomous-scheduling/OperationalMetricsAggregator');
const { getPolicy } = require('../autonomous-scheduling/AutonomousSchedulePolicyService');
const { getPreset } = require('../autonomous-scheduling/VerticalTemplateRegistry');
const { getRuntime } = require('../autonomous-scheduling/AutonomousRuntimeService');
const { structuredReason } = require('../autonomous-scheduling/runtime');

function normalizeOpportunity(row) {
  const item = getJson(row);
  const metadata = item.metadata || {};
  return {
    ...item,
    reasons: Array.isArray(metadata.reasons) ? metadata.reasons : [],
    reasonCodes: Array.isArray(metadata.reasonCodes)
      ? metadata.reasonCodes
      : (Array.isArray(metadata.reasons) ? metadata.reasons.map((entry) => entry.code).filter(Boolean) : []),
  };
}

async function ensureOpportunity({ tenantId, type, entityId = null, serviceType = null, estimatedValue = 0, confidence = 0, metadata = {} }) {
  const Model = RevenueOpportunity();
  const existing = await Model.findOne({
    where: {
      tenant_key: String(tenantId),
      type: String(type),
      entity_id: entityId ? String(entityId) : null,
      service_type: serviceType ? String(serviceType) : null,
      status: 'open',
    },
  });
  if (existing) return normalizeOpportunity(existing);
  const row = await Model.create({
    id: newId('revopp'),
    tenant_key: String(tenantId),
    type: String(type),
    entity_id: entityId ? String(entityId) : null,
    service_type: serviceType ? String(serviceType) : null,
    estimated_value: estimatedValue,
    confidence,
    status: 'open',
    metadata,
  });
  return normalizeOpportunity(row);
}

async function detectOpportunities({ tenantId }) {
  const [policy, runtimeOut] = await Promise.all([
    getPolicy(tenantId),
    getRuntime(tenantId),
  ]);
  const template = policy?.settings?.verticalTemplate || 'beauty';
  const preset = getPreset(template);
  const runtime = runtimeOut.runtime || {};
  if (!runtime.revenueEnabled) {
    return {
      ok: true,
      disabled: true,
      reasons: [structuredReason('runtime_disabled', 'Revenue engine desabilitado no runtime.', { severity: 'warning' })],
      items: [],
    };
  }

  const [metricsOut, contacts, campaigns] = await Promise.all([
    getAggregatedMetrics({ tenantId }),
    CrmContact().findAll({ where: { tenant_key: String(tenantId), status: 'active' }, limit: 50, order: [['updated_at', 'DESC']] }),
    AutonomousGapCampaign().findAll({ where: { tenant_key: String(tenantId) }, limit: 20, order: [['created_at', 'DESC']] }),
  ]);

  const metrics = metricsOut.items?.[0] || {};
  const created = [];
  if ((metrics.fillRate || 0) < 55) {
    created.push(await ensureOpportunity({
      tenantId,
      type: 'fill_gap',
      serviceType: policy?.settings?.serviceType || null,
      estimatedValue: preset.revenueDefaults?.avgTicketValue || 0,
      confidence: 0.72,
      metadata: {
        source: 'aggregated_metrics',
        fillRate: metrics.fillRate || 0,
        reasons: [structuredReason('revenue_recovery', 'Fill rate baixo indica oportunidade de recuperação de receita.', { severity: 'warning' })],
        reasonCodes: ['revenue_recovery'],
      },
    }));
  }

  for (const contactRow of contacts.slice(0, 3)) {
    const contact = getJson(contactRow);
    created.push(await ensureOpportunity({
      tenantId,
      type: 'reactivation',
      entityId: contact.id,
      estimatedValue: preset.revenueDefaults?.avgTicketValue || 0,
      confidence: 0.48,
      metadata: {
        contactName: contact.name || null,
        reasons: [structuredReason('revenue_recovery', 'Contato recente pode ser reativado para gerar nova receita.', { severity: 'info' })],
        reasonCodes: ['revenue_recovery'],
      },
    }));
  }

  if ((campaigns || []).some((item) => String(item.status || '').toLowerCase() === 'filled')) {
    created.push(await ensureOpportunity({
      tenantId,
      type: 'upsell',
      serviceType: policy?.settings?.serviceType || null,
      estimatedValue: Number((preset.revenueDefaults?.avgTicketValue || 0) * 0.35).toFixed(2),
      confidence: 0.4,
      metadata: {
        source: 'filled_campaign',
        reasons: [structuredReason('service_affinity', 'Campanhas preenchidas recentes sugerem espaço para upsell.', { severity: 'info' })],
        reasonCodes: ['service_affinity'],
      },
    }));
  }

  created.push(await ensureOpportunity({
    tenantId,
    type: 'retention',
    serviceType: policy?.settings?.serviceType || null,
    estimatedValue: Number((preset.revenueDefaults?.avgTicketValue || 0) * 0.5).toFixed(2),
    confidence: 0.52,
    metadata: {
      verticalTemplate: template,
      reasons: [structuredReason('revenue_recovery', 'Estratégia de retenção recomendada pelo preset vertical.', { severity: 'info' })],
      reasonCodes: ['revenue_recovery'],
    },
  }));

  return { ok: true, items: created };
}

async function listOpportunities({ tenantId }) {
  const rows = await RevenueOpportunity().findAll({
    where: { tenant_key: String(tenantId), status: 'open' },
    order: [['created_at', 'DESC']],
    limit: 100,
  });
  return { ok: true, items: rows.map(normalizeOpportunity) };
}

module.exports = {
  detectOpportunities,
  listOpportunities,
};

/**
 * ROI analytics (v1).
 *
 * Objetivo:
 * - Oferecer um resumo simples de ROI baseado em pedidos e leads
 * - Suporta janela configurável via ROI_WINDOW_DAYS
 * - Custo opcional via ROI_MARKETING_COST
 */
'use strict';

const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function floatEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : def;
}

function jsonEnv(name, def) {
  const raw = process.env[name];
  if (!raw) return def;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : def;
  } catch (_) {
    return def;
  }
}

function safeNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function getVoiceCostForWindow({ sequelize, tenantId, days }) {
  const costPerMinute = floatEnv('VOICE_COST_PER_MINUTE', 0);
  if (!costPerMinute || costPerMinute <= 0) {
    return { totalBillSeconds: 0, totalMinutes: 0, estimatedCost: 0, costPerMinute };
  }
  const [rows] = await sequelize.query(
    `SELECT
       COALESCE(SUM(COALESCE((payload->>'billsec')::float, (payload->>'duration')::float, 0)), 0)::float AS total_billsec
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND type IN ('CallEnded', 'VoiceCallEnded')
       AND received_at >= NOW() - (:days || ' days')::interval`,
    { replacements: { tenantKey: String(tenantId), days: Number(days) } },
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const totalBillSeconds = safeNumber(row.total_billsec || 0, 0);
  const totalMinutes = totalBillSeconds > 0 ? Number((totalBillSeconds / 60).toFixed(2)) : 0;
  const estimatedCost = totalMinutes > 0 ? Number((totalMinutes * costPerMinute).toFixed(2)) : 0;
  return { totalBillSeconds, totalMinutes, estimatedCost, costPerMinute };
}

async function getRoiSummary({ tenantId, windowDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };

  const days = Number.isFinite(Number(windowDays)) ? Math.max(1, Math.floor(Number(windowDays))) : intEnv('ROI_WINDOW_DAYS', 30);
  const marketingCost = floatEnv('ROI_MARKETING_COST', 0);
  const operationalCostPerOrder = floatEnv('ROI_OPERATIONAL_COST_PER_ORDER', 0);
  const operationalCostPerLead = floatEnv('ROI_OPERATIONAL_COST_PER_LEAD', 0);

  const replacements = { tenantKey: String(tenantId), days };

  const [orderRows] = await sequelize.query(
    `SELECT
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(total_amount), 0)::float AS total_revenue,
       COALESCE(AVG(total_amount), 0)::float AS avg_order_value
     FROM orders
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval`,
    { replacements },
  );

  const [leadRows] = await sequelize.query(
    `SELECT
       COUNT(*)::int AS total_leads,
       COALESCE(AVG(score), 0)::float AS avg_score
     FROM marketing_leads
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval`,
    { replacements },
  );

  const [orderSourceRows] = await sequelize.query(
    `SELECT
       source,
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(total_amount), 0)::float AS total_revenue
     FROM orders
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval
     GROUP BY source
     ORDER BY total_orders DESC`,
    { replacements },
  );

  const o = Array.isArray(orderRows) && orderRows[0] ? orderRows[0] : {};
  const l = Array.isArray(leadRows) && leadRows[0] ? leadRows[0] : {};
  const voiceCosts = await getVoiceCostForWindow({ sequelize, tenantId, days });

  const totalRevenue = Number(o.total_revenue || 0);
  const totalLeads = Number(l.total_leads || 0);
  const totalOrders = Number(o.total_orders || 0);
  const revenuePerLead = totalLeads > 0 ? totalRevenue / totalLeads : 0;
  const roi = marketingCost > 0 ? (totalRevenue - marketingCost) / marketingCost : null;
  const channelCosts = jsonEnv('ROI_CHANNEL_COSTS', {});
  const totalChannelCost = Object.values(channelCosts || {}).reduce((sum, v) => sum + safeNumber(v, 0), 0);
  const totalOrderOperationalCost = totalOrders > 0 ? Number((totalOrders * operationalCostPerOrder).toFixed(2)) : 0;
  const totalLeadOperationalCost = totalLeads > 0 ? Number((totalLeads * operationalCostPerLead).toFixed(2)) : 0;
  const totalOperationalCost = Number((totalOrderOperationalCost + totalLeadOperationalCost + voiceCosts.estimatedCost).toFixed(2));
  const orderSources = (orderSourceRows || []).map((row) => {
    const source = String(row?.source || 'unknown');
    const orders = safeNumber(row?.total_orders || 0, 0);
    const revenue = safeNumber(row?.total_revenue || 0, 0);
    const cost = safeNumber(channelCosts[source] || 0, 0);
    const orderShare = totalOrders > 0 ? orders / totalOrders : 0;
    const operationalCost = Number(((orders * operationalCostPerOrder) + (voiceCosts.estimatedCost * orderShare)).toFixed(2));
    const blendedCost = Number((cost + operationalCost).toFixed(2));
    const margin = Number((revenue - blendedCost).toFixed(2));
    return {
      source,
      orders,
      revenue,
      cost,
      costPerOrder: orders > 0 ? Number((cost / orders).toFixed(4)) : null,
      roi: cost > 0 ? Number(((revenue - cost) / cost).toFixed(4)) : null,
      operationalCost,
      blendedCost,
      blendedCostPerOrder: orders > 0 ? Number((blendedCost / orders).toFixed(4)) : null,
      margin,
      blendedRoi: blendedCost > 0 ? Number(((revenue - blendedCost) / blendedCost).toFixed(4)) : null,
    };
  });

  return {
    ok: true,
    windowDays: days,
    marketingCost,
    totalChannelCost,
    orders: {
      total: totalOrders,
      totalRevenue,
      avgOrderValue: Number(o.avg_order_value || 0),
    },
    leads: {
      total: totalLeads,
      avgScore: Number(l.avg_score || 0),
    },
    revenuePerLead,
    roi,
    operationalCosts: {
      total: totalOperationalCost,
      perOrder: operationalCostPerOrder,
      perLead: operationalCostPerLead,
      orderOperationalCost: totalOrderOperationalCost,
      leadOperationalCost: totalLeadOperationalCost,
      voice: voiceCosts,
    },
    blendedCost: Number((totalChannelCost + totalOperationalCost).toFixed(2)),
    blendedRoi:
      (totalChannelCost + totalOperationalCost) > 0
        ? Number(((totalRevenue - (totalChannelCost + totalOperationalCost)) / (totalChannelCost + totalOperationalCost)).toFixed(4))
        : null,
    orderSources,
  };
}

async function getFunnelMetrics({ tenantId, windowDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };

  const days = Number.isFinite(Number(windowDays)) ? Math.max(1, Math.floor(Number(windowDays))) : intEnv('ROI_WINDOW_DAYS', 30);
  const replacements = { tenantKey: String(tenantId), days };

  const [leadStageRows] = await sequelize.query(
    `SELECT stage, COUNT(*)::int AS total
     FROM marketing_leads
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval
     GROUP BY stage`,
    { replacements },
  );

  const [leadChannelRows] = await sequelize.query(
    `SELECT
       COALESCE(attributes->>'source', attributes->>'channel', attributes->>'utm_source', 'unknown') AS channel,
       COUNT(*)::int AS total
     FROM marketing_leads
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval
     GROUP BY channel
     ORDER BY total DESC`,
    { replacements },
  );

  const [submissionRows] = await sequelize.query(
    `SELECT
       COUNT(*)::int AS total_submissions,
       COUNT(DISTINCT lead_id)::int AS unique_leads
     FROM marketing_form_submissions
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval`,
    { replacements },
  );

  const [orderRows] = await sequelize.query(
    `SELECT
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(total_amount), 0)::float AS total_revenue
     FROM orders
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval`,
    { replacements },
  );

  const [orderSourceRows] = await sequelize.query(
    `SELECT
       source,
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(total_amount), 0)::float AS total_revenue
     FROM orders
     WHERE tenant_key = :tenantKey
       AND created_at >= NOW() - (:days || ' days')::interval
     GROUP BY source
     ORDER BY total_orders DESC`,
    { replacements },
  );

  const stageCounts = {};
  for (const row of (leadStageRows || [])) {
    if (!row) continue;
    stageCounts[String(row.stage || 'unknown')] = Number(row.total || 0);
  }

  const stagesOrdered = ['visitor', 'lead', 'mql', 'sql', 'customer'];
  const stages = stagesOrdered.map((stage) => ({
    stage,
    total: stageCounts[stage] || 0,
  }));

  const extraStages = Object.keys(stageCounts).filter((s) => !stagesOrdered.includes(s));
  for (const stage of extraStages) {
    stages.push({ stage, total: stageCounts[stage] || 0 });
  }

  const totalLeads = stages.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const leadCount = stageCounts.lead || 0;
  const customerCount = stageCounts.customer || 0;
  const leadToCustomerRate = leadCount > 0 ? Number((customerCount / leadCount).toFixed(4)) : null;

  const submissionRow = Array.isArray(submissionRows) && submissionRows[0] ? submissionRows[0] : {};
  const orderRow = Array.isArray(orderRows) && orderRows[0] ? orderRows[0] : {};

  const channelCosts = jsonEnv('ROI_CHANNEL_COSTS', {});
  const operationalCostPerOrder = floatEnv('ROI_OPERATIONAL_COST_PER_ORDER', 0);
  const voiceCosts = await getVoiceCostForWindow({ sequelize, tenantId, days });
  const totalOrdersFromSources = (orderSourceRows || []).reduce((sum, row) => sum + safeNumber(row?.total_orders || 0, 0), 0);
  const orderSourceMap = new Map(
    (orderSourceRows || []).map((row) => [
      String(row?.source || 'unknown').toLowerCase(),
      {
        orders: safeNumber(row?.total_orders || 0, 0),
        revenue: safeNumber(row?.total_revenue || 0, 0),
      },
    ]),
  );
  const channels = (leadChannelRows || []).map((row) => {
    const channel = String(row?.channel || 'unknown');
    const leads = safeNumber(row?.total || 0, 0);
    const cost = safeNumber(channelCosts[channel] || 0, 0);
    const orderData = orderSourceMap.get(channel.toLowerCase()) || { orders: 0, revenue: 0 };
    const orders = safeNumber(orderData.orders || 0, 0);
    const revenue = safeNumber(orderData.revenue || 0, 0);
    const orderShare = totalOrdersFromSources > 0 ? orders / totalOrdersFromSources : 0;
    const operationalCost = Number(((orders * operationalCostPerOrder) + (voiceCosts.estimatedCost * orderShare)).toFixed(2));
    const blendedCost = Number((cost + operationalCost).toFixed(2));
    const margin = Number((revenue - blendedCost).toFixed(2));
    return {
      channel,
      leads,
      cost,
      costPerLead: leads > 0 ? Number((cost / leads).toFixed(4)) : null,
      orders,
      revenue,
      leadToOrderRate: leads > 0 ? Number((orders / leads).toFixed(4)) : null,
      operationalCost,
      blendedCost,
      blendedRoi: blendedCost > 0 ? Number(((revenue - blendedCost) / blendedCost).toFixed(4)) : null,
      margin,
    };
  });

  const orderSources = (orderSourceRows || []).map((row) => {
    const source = String(row?.source || 'unknown');
    const orders = safeNumber(row?.total_orders || 0, 0);
    const revenue = safeNumber(row?.total_revenue || 0, 0);
    const cost = safeNumber(channelCosts[source] || 0, 0);
    return {
      source,
      orders,
      revenue,
      cost,
      costPerOrder: orders > 0 ? Number((cost / orders).toFixed(4)) : null,
      roi: cost > 0 ? Number(((revenue - cost) / cost).toFixed(4)) : null,
    };
  });

  return {
    ok: true,
    windowDays: days,
    totals: {
      leads: totalLeads,
      formSubmissions: Number(submissionRow.total_submissions || 0),
      formSubmissionLeads: Number(submissionRow.unique_leads || 0),
      orders: Number(orderRow.total_orders || 0),
      revenue: Number(orderRow.total_revenue || 0),
    },
    stages,
    conversionRates: {
      leadToCustomer: leadToCustomerRate,
    },
    channels,
    orderSources,
    totalChannelCost: Object.values(channelCosts || {}).reduce((sum, v) => sum + safeNumber(v, 0), 0),
    operationalCosts: {
      perOrder: operationalCostPerOrder,
      voice: voiceCosts,
    },
  };
}

module.exports = { getRoiSummary, getFunnelMetrics };

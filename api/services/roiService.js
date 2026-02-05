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

async function getRoiSummary({ tenantId, windowDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };

  const days = Number.isFinite(Number(windowDays)) ? Math.max(1, Math.floor(Number(windowDays))) : intEnv('ROI_WINDOW_DAYS', 30);
  const marketingCost = floatEnv('ROI_MARKETING_COST', 0);

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

  const totalRevenue = Number(o.total_revenue || 0);
  const totalLeads = Number(l.total_leads || 0);
  const revenuePerLead = totalLeads > 0 ? totalRevenue / totalLeads : 0;
  const roi = marketingCost > 0 ? (totalRevenue - marketingCost) / marketingCost : null;
  const channelCosts = jsonEnv('ROI_CHANNEL_COSTS', {});
  const orderSources = (orderSourceRows || []).map((row) => ({
    source: String(row?.source || 'unknown'),
    orders: Number(row?.total_orders || 0),
    revenue: Number(row?.total_revenue || 0),
    cost: Number(channelCosts[String(row?.source || 'unknown')] || 0),
  }));

  return {
    ok: true,
    windowDays: days,
    marketingCost,
    orders: {
      total: Number(o.total_orders || 0),
      totalRevenue,
      avgOrderValue: Number(o.avg_order_value || 0),
    },
    leads: {
      total: totalLeads,
      avgScore: Number(l.avg_score || 0),
    },
    revenuePerLead,
    roi,
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
  const channels = (leadChannelRows || []).map((row) => {
    const channel = String(row?.channel || 'unknown');
    const cost = Number(channelCosts[channel] || 0);
    return {
      channel,
      leads: Number(row?.total || 0),
      cost,
    };
  });

  const orderSources = (orderSourceRows || []).map((row) => ({
    source: String(row?.source || 'unknown'),
    orders: Number(row?.total_orders || 0),
    revenue: Number(row?.total_revenue || 0),
  }));

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
  };
}

module.exports = { getRoiSummary, getFunnelMetrics };

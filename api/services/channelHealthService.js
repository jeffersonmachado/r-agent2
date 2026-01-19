/**
 * Channel Health Service
 *
 * Objetivo:
 * - Consolidar saúde de canais (WhatsApp/Instagram/Webchat) a partir das tabelas:
 *   - channel_accounts
 *   - channel_conversations + channel_messages
 *   - outbound_queue
 * - Gerar alertas quando taxa de falha de outbound ultrapassar limiar.
 *
 * Observação:
 * - Best-effort: se DB indisponível, retorna saúde "unknown".
 */

'use strict';

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelAccount, OutboundQueueItem } = require('../db/models');
const { emitEvent } = require('./websocketService');

function dbAvailable() {
  return !!getSequelize();
}

function safeInt(v, d = 0) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : d;
}

function safeFloat(v, d = 0) {
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function computeStatus({ failRate, outboundPending, hasActiveAccount, totalOut, minSamples, failRateThreshold }) {
  // Regras simples e determinísticas
  if (!hasActiveAccount) return { status: 'unhealthy', reason: 'no_active_account' };
  if (outboundPending >= 200) return { status: 'degraded', reason: 'outbound_backlog_high' };
  if (totalOut >= minSamples && failRate >= failRateThreshold) {
    const severity = failRate >= 0.5 ? 'unhealthy' : 'degraded';
    return { status: severity, reason: 'high_failure_rate' };
  }
  return { status: 'healthy', reason: 'ok' };
}

async function queryAccountsByType(tenantId) {
  if (!dbAvailable()) return [];
  const Model = typeof ChannelAccount === 'function' ? ChannelAccount() : ChannelAccount;
  const sequelize = Model.sequelize;
  const [rows] = await sequelize.query(
    `
    SELECT type,
           COUNT(*)::int AS total,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int AS active
    FROM channel_accounts
    WHERE tenant_key = :tenant
    GROUP BY type
    `,
    { replacements: { tenant: tenantId } }
  );
  return Array.isArray(rows) ? rows : [];
}

async function queryOutboundQueueStats(tenantId, now) {
  if (!dbAvailable()) return { byChannel: [], totals: { pending: 0, dueNow: 0, oldestPendingSeconds: null } };
  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const sequelize = Model.sequelize;
  const nowIso = now.toISOString();

  const [rows] = await sequelize.query(
    `
    SELECT channel_type,
           SUM(CASE WHEN status IN ('pending','failed') THEN 1 ELSE 0 END)::int AS pending,
           SUM(CASE WHEN status IN ('pending','failed') AND next_attempt_at <= :now THEN 1 ELSE 0 END)::int AS due_now,
           MIN(CASE WHEN status IN ('pending','failed') THEN created_at ELSE NULL END) AS oldest_pending_at
    FROM outbound_queue
    WHERE tenant_key = :tenant
    GROUP BY channel_type
    `,
    { replacements: { tenant: tenantId, now: nowIso } }
  );

  const byChannel = (Array.isArray(rows) ? rows : []).map((r) => {
    const oldest = r.oldest_pending_at ? new Date(r.oldest_pending_at) : null;
    const oldestSeconds = oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)) : null;
    return {
      channelType: r.channel_type,
      pending: safeInt(r.pending, 0),
      dueNow: safeInt(r.due_now, 0),
      oldestPendingSeconds: oldestSeconds,
    };
  });

  const totals = {
    pending: byChannel.reduce((a, x) => a + (x.pending || 0), 0),
    dueNow: byChannel.reduce((a, x) => a + (x.dueNow || 0), 0),
    oldestPendingSeconds: byChannel.reduce((acc, x) => {
      if (x.oldestPendingSeconds === null || x.oldestPendingSeconds === undefined) return acc;
      if (acc === null) return x.oldestPendingSeconds;
      return Math.max(acc, x.oldestPendingSeconds);
    }, null),
  };

  return { byChannel, totals };
}

async function queryDeliveryStats(tenantId, since) {
  if (!dbAvailable()) return [];
  const sequelize = getSequelize();
  const [rows] = await sequelize.query(
    `
    SELECT c.channel_type,
           COUNT(*) FILTER (WHERE m.direction = 'out' AND m.created_at >= :since)::int AS out_total,
           COUNT(*) FILTER (WHERE m.direction = 'out' AND m.status = 'failed' AND m.created_at >= :since)::int AS out_failed
    FROM channel_messages m
    JOIN channel_conversations c
      ON c.id = m.conversation_id
     AND c.tenant_key = :tenant
    WHERE m.tenant_key = :tenant
    GROUP BY c.channel_type
    `,
    { replacements: { tenant: tenantId, since: since.toISOString() } }
  );
  return Array.isArray(rows) ? rows : [];
}

function normalizeChannelType(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'whatsapp' || s === 'instagram' || s === 'webchat') return s;
  return s || 'unknown';
}

async function getChannelHealth({ tenantId, windowMinutes = 10, now = new Date(), failRateThreshold = 0.15, minSamples = 20 } = {}) {
  const windowM = Math.max(1, safeInt(windowMinutes, 10));
  const since = new Date(now.getTime() - windowM * 60 * 1000);

  if (!tenantId) {
    return {
      timestamp: now.toISOString(),
      tenantId: null,
      windowMinutes: windowM,
      overall: { status: 'unknown', reason: 'missing_tenant' },
      channels: {},
      outboundQueue: { totals: { pending: 0, dueNow: 0, oldestPendingSeconds: null }, byChannel: [] },
      alerts: [],
    };
  }

  if (!dbAvailable()) {
    return {
      timestamp: now.toISOString(),
      tenantId,
      windowMinutes: windowM,
      overall: { status: 'unknown', reason: 'db_unavailable' },
      channels: {},
      outboundQueue: { totals: { pending: 0, dueNow: 0, oldestPendingSeconds: null }, byChannel: [] },
      alerts: [],
    };
  }

  const [accountsRows, outbound, deliveryRows] = await Promise.all([
    queryAccountsByType(tenantId),
    queryOutboundQueueStats(tenantId, now),
    queryDeliveryStats(tenantId, since),
  ]);

  const byTypeAccounts = {};
  for (const r of accountsRows) {
    const ct = normalizeChannelType(r.type);
    byTypeAccounts[ct] = { total: safeInt(r.total, 0), active: safeInt(r.active, 0) };
  }

  const byTypeDelivery = {};
  for (const r of deliveryRows) {
    const ct = normalizeChannelType(r.channel_type);
    byTypeDelivery[ct] = { outTotal: safeInt(r.out_total, 0), outFailed: safeInt(r.out_failed, 0) };
  }

  const byTypeOutbound = {};
  for (const r of outbound.byChannel) {
    const ct = normalizeChannelType(r.channelType);
    byTypeOutbound[ct] = r;
  }

  const channelTypes = Array.from(new Set([
    ...Object.keys(byTypeAccounts),
    ...Object.keys(byTypeDelivery),
    ...Object.keys(byTypeOutbound),
    'whatsapp',
    'instagram',
    'webchat',
  ])).filter(Boolean);

  const channels = {};
  const alerts = [];
  for (const ct of channelTypes) {
    const accounts = byTypeAccounts[ct] || { total: 0, active: 0 };
    const delivery = byTypeDelivery[ct] || { outTotal: 0, outFailed: 0 };
    const outq = byTypeOutbound[ct] || { pending: 0, dueNow: 0, oldestPendingSeconds: null };

    const failRate = delivery.outTotal > 0 ? clamp01(delivery.outFailed / delivery.outTotal) : 0;
    const statusObj = computeStatus({
      failRate,
      outboundPending: outq.pending || 0,
      hasActiveAccount: (accounts.active || 0) > 0 || ct === 'webchat', // webchat pode não ter account ainda
      totalOut: delivery.outTotal || 0,
      minSamples,
      failRateThreshold,
    });

    const status = ct === 'webchat' && (accounts.total || 0) === 0 && (delivery.outTotal || 0) === 0
      ? { status: 'unknown', reason: 'no_data' }
      : statusObj;

    if ((delivery.outTotal || 0) >= minSamples && failRate >= failRateThreshold) {
      alerts.push({
        type: 'high_failure_rate',
        channelType: ct,
        severity: failRate >= 0.5 ? 'critical' : 'warning',
        message: `Taxa de falha alta em ${ct}: ${(failRate * 100).toFixed(1)}% (${delivery.outFailed}/${delivery.outTotal}) em ${windowM} min.`,
        metrics: { failRate, outTotal: delivery.outTotal, outFailed: delivery.outFailed, windowMinutes: windowM },
      });
    }

    channels[ct] = {
      channelType: ct,
      status: status.status,
      reason: status.reason,
      accounts,
      delivery: { ...delivery, failRate },
      outboundQueue: outq,
    };
  }

  const severityRank = { healthy: 0, degraded: 1, unhealthy: 2, unknown: 3 };
  const overallStatus = Object.values(channels).reduce((acc, c) => {
    if (!acc) return c;
    return (severityRank[c.status] > severityRank[acc.status]) ? c : acc;
  }, null);

  const overall = overallStatus
    ? { status: overallStatus.status, reason: overallStatus.reason }
    : { status: 'unknown', reason: 'no_data' };

  return {
    timestamp: now.toISOString(),
    tenantId,
    windowMinutes: windowM,
    thresholds: { failRateThreshold, minSamples },
    overall,
    channels,
    outboundQueue: outbound,
    alerts,
  };
}

let monitorInterval = null;
const lastAlertAt = new Map(); // key = tenantId:channelType:type

function startChannelHealthMonitor({
  intervalMs = 60000,
  windowMinutes = 10,
  failRateThreshold = 0.15,
  minSamples = 20,
  cooldownMinutes = 10,
} = {}) {
  if (monitorInterval) return;
  if (!dbAvailable()) return;

  const cooldownMs = Math.max(1, safeInt(cooldownMinutes, 10)) * 60 * 1000;

  monitorInterval = setInterval(async () => {
    try {
      const sequelize = getSequelize();
      const [rows] = await sequelize.query(
        `
        SELECT DISTINCT tenant_key
        FROM (
          SELECT tenant_key FROM channel_accounts
          UNION
          SELECT tenant_key FROM outbound_queue
          UNION
          SELECT tenant_key FROM channel_conversations
        ) t
        `
      );
      const tenants = (Array.isArray(rows) ? rows : []).map(r => r.tenant_key).filter(Boolean);

      for (const tenantId of tenants) {
        // eslint-disable-next-line no-await-in-loop
        const health = await getChannelHealth({ tenantId, windowMinutes, failRateThreshold, minSamples });
        if (!health.alerts || health.alerts.length === 0) continue;

        for (const a of health.alerts) {
          const key = `${tenantId}:${a.channelType}:${a.type}`;
          const prev = lastAlertAt.get(key) || 0;
          const now = Date.now();
          if (now - prev < cooldownMs) continue;
          lastAlertAt.set(key, now);

          logger.warn('[ChannelHealth] Alerta', { tenantId, ...a });
          emitEvent('channel.health.alert', { tenantId, ...a }, { tenantId });
        }
      }
    } catch (err) {
      logger.warn('[ChannelHealth] Falha no monitor (ignorado)', { error: err.message });
    }
  }, Math.max(5000, safeInt(intervalMs, 60000)));
}

function stopChannelHealthMonitor() {
  if (monitorInterval) clearInterval(monitorInterval);
  monitorInterval = null;
}

module.exports = {
  getChannelHealth,
  startChannelHealthMonitor,
  stopChannelHealthMonitor,
  _internal: {
    computeStatus,
  },
};


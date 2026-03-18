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
const { logAction } = require('./auditService');
const { decrypt } = require('../utils/crypto');
const https = require('https');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value).trim();
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  try {
    return err.message || String(err) || fallback;
  } catch (_) {
    return fallback;
  }
}

function dbAvailable() {
  return !!getSequelize();
}

function safeInt(v, d = 0) {
  const n = Number.parseInt(safeToString(v), 10);
  return Number.isFinite(n) ? n : d;
}

function safeFloat(v, d = 0) {
  const n = Number.parseFloat(safeToString(v));
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
           SUM(CASE WHEN status IN ('pending','failed') AND attempts > 0 THEN 1 ELSE 0 END)::int AS retrying,
           MAX(CASE WHEN status IN ('pending','failed') THEN attempts ELSE NULL END)::int AS max_attempts,
           AVG(CASE WHEN status IN ('pending','failed') THEN attempts ELSE NULL END)::float AS avg_attempts,
           AVG(CASE WHEN status IN ('pending','failed') AND next_attempt_at <= :now THEN EXTRACT(EPOCH FROM (:now::timestamptz - next_attempt_at)) ELSE NULL END)::float AS overdue_avg_seconds,
           MAX(CASE WHEN status IN ('pending','failed') AND next_attempt_at <= :now THEN EXTRACT(EPOCH FROM (:now::timestamptz - next_attempt_at)) ELSE NULL END)::float AS overdue_max_seconds,
           SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END)::int AS sending,
           AVG(CASE WHEN status = 'sending' AND processing_at IS NOT NULL THEN EXTRACT(EPOCH FROM (:now::timestamptz - processing_at)) ELSE NULL END)::float AS sending_age_avg_seconds,
           MAX(CASE WHEN status = 'sending' AND processing_at IS NOT NULL THEN EXTRACT(EPOCH FROM (:now::timestamptz - processing_at)) ELSE NULL END)::float AS sending_age_max_seconds,
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
      retrying: safeInt(r.retrying, 0),
      maxAttempts: safeInt(r.max_attempts, 0),
      avgAttempts: safeFloat(r.avg_attempts, 0),
      overdueAvgSeconds: safeFloat(r.overdue_avg_seconds, 0),
      overdueMaxSeconds: safeFloat(r.overdue_max_seconds, 0),
      sending: safeInt(r.sending, 0),
      sendingAgeAvgSeconds: safeFloat(r.sending_age_avg_seconds, 0),
      sendingAgeMaxSeconds: safeFloat(r.sending_age_max_seconds, 0),
    };
  });

  const totals = {
    pending: byChannel.reduce((a, x) => a + (x.pending || 0), 0),
    dueNow: byChannel.reduce((a, x) => a + (x.dueNow || 0), 0),
    retrying: byChannel.reduce((a, x) => a + (x.retrying || 0), 0),
    sending: byChannel.reduce((a, x) => a + (x.sending || 0), 0),
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
           COUNT(*) FILTER (WHERE m.direction = 'out' AND m.status = 'failed' AND m.created_at >= :since)::int AS out_failed,
           COUNT(*) FILTER (WHERE m.direction = 'out' AND m.status = 'sent' AND m.created_at >= :since)::int AS out_sent,
           COUNT(*) FILTER (WHERE m.direction = 'out' AND m.status = 'received' AND m.created_at >= :since)::int AS out_received,
           COUNT(*) FILTER (WHERE m.direction = 'in' AND m.created_at >= :since)::int AS in_total
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

function safeDecryptConfig(configEncrypted) {
  if (!configEncrypted) return null;
  try {
    return JSON.parse(decrypt(configEncrypted));
  } catch {
    return null;
  }
}

function httpGetJson(url, { headers = {}, timeoutMs = 3500 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      method: 'GET',
      hostname: u.hostname,
      path: `${u.pathname}${u.search || ''}`,
      headers,
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        const isJson = safeToString(contentType).includes('application/json');
        let parsed = null;
        if (isJson) {
          try { parsed = JSON.parse(data || '{}'); } catch { parsed = null; }
        }
        resolve({ statusCode: res.statusCode, data: parsed, raw: data });
      });
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const waQualityCache = new Map(); // accountId -> { atMs, qualityRating, profile }

function getAny(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && safeTrim(obj[k]) !== '') return obj[k];
  }
  return undefined;
}

async function fetchWhatsAppQualityBestEffort({ accountId, cfg, externalId, nowMs }) {
  const cached = waQualityCache.get(accountId);
  if (cached && (nowMs - cached.atMs) < (15 * 60 * 1000)) return cached;

  const apiUrl = safeToString(getAny(cfg, ['apiUrl', 'api_url']) || 'https://graph.facebook.com/v18.0');
  const token = getAny(cfg, ['accessToken', 'token', 'whatsappAccessToken', 'pageAccessToken']);
  const phoneNumberId = externalId || getAny(cfg, ['phone_number_id', 'phoneNumberId', 'phone_numberId']);
  if (!token || !phoneNumberId) return null;

  const url = `${apiUrl.replace(/\/$/, '')}/${encodeURIComponent(safeToString(phoneNumberId))}?fields=quality_rating,verified_name,display_phone_number,name_status`;
  try {
    const resp = await httpGetJson(url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 3500 });
    if (!(resp.statusCode >= 200 && resp.statusCode < 300)) return null;
    const profile = resp.data && typeof resp.data === 'object' ? resp.data : null;
    const qualityRating = profile?.quality_rating || profile?.qualityRating || null;
    const entry = {
      atMs: nowMs,
      qualityRating,
      profile: profile ? {
        quality_rating: profile.quality_rating || null,
        name_status: profile.name_status || null,
        verified_name: profile.verified_name || null,
        display_phone_number: profile.display_phone_number || null,
      } : null,
    };
    waQualityCache.set(accountId, entry);
    return entry;
  } catch {
    return null;
  }
}

async function queryAccountDiagnostics(tenantId) {
  if (!dbAvailable()) return { byChannel: {}, accounts: [] };
  const Model = typeof ChannelAccount === 'function' ? ChannelAccount() : ChannelAccount;
  const rows = await Model.findAll({ where: { tenant_key: tenantId }, order: [['created_at', 'DESC']] });
  const nowMs = Date.now();

  const accounts = [];
  for (const row of rows) {
    const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
    const type = normalizeChannelType(base.type);
    const status = safeToString(base.status || 'unknown').toLowerCase();
    const externalId = base.external_id ? safeToString(base.external_id) : null;

    const cfg = safeDecryptConfig(base.config_encrypted);
    const missing = [];
    if (type === 'whatsapp') {
      const token = getAny(cfg, ['accessToken', 'token', 'whatsappAccessToken', 'pageAccessToken']);
      const phoneNumberId = externalId || getAny(cfg, ['phone_number_id', 'phoneNumberId', 'phone_numberId']);
      if (!token) missing.push('token/accessToken');
      if (!phoneNumberId) missing.push('externalId (phone_number_id)');
    } else if (type === 'instagram') {
      const token = getAny(cfg, ['pageAccessToken', 'accessToken', 'token']);
      const pageId = externalId || getAny(cfg, ['pageId', 'page_id']);
      if (!token) missing.push('pageAccessToken/accessToken');
      if (!pageId) missing.push('externalId (pageId)');
    }

    let waQuality = null;
    if (type === 'whatsapp' && status === 'active' && cfg) {
      // eslint-disable-next-line no-await-in-loop
      waQuality = await fetchWhatsAppQualityBestEffort({ accountId: base.id, cfg, externalId, nowMs });
    }

    accounts.push({
      id: base.id,
      type,
      status,
      externalId,
      configOk: missing.length === 0,
      missing,
      whatsapp: waQuality ? { qualityRating: waQuality.qualityRating || null, profile: waQuality.profile || null } : undefined,
      updatedAt: base.updated_at ? new Date(base.updated_at).toISOString() : (base.updatedAt?.toISOString?.() || null),
    });
  }

  const byChannel = accounts.reduce((acc, a) => {
    const ct = a.type || 'unknown';
    acc[ct] = acc[ct] || { total: 0, active: 0, configOkActive: 0, whatsappQualityRatings: [] };
    acc[ct].total += 1;
    if (a.status === 'active') {
      acc[ct].active += 1;
      if (a.configOk) acc[ct].configOkActive += 1;
      if (ct === 'whatsapp' && a.whatsapp?.qualityRating) acc[ct].whatsappQualityRatings.push(a.whatsapp.qualityRating);
    }
    return acc;
  }, {});

  return { byChannel, accounts };
}

function normalizeChannelType(t) {
  const s = safeToString(t || '').toLowerCase();
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

  const [accountsRows, outbound, deliveryRows, accountDiagnostics] = await Promise.all([
    queryAccountsByType(tenantId),
    queryOutboundQueueStats(tenantId, now),
    queryDeliveryStats(tenantId, since),
    queryAccountDiagnostics(tenantId),
  ]);

  const byTypeAccounts = {};
  for (const r of accountsRows) {
    const ct = normalizeChannelType(r.type);
    byTypeAccounts[ct] = { total: safeInt(r.total, 0), active: safeInt(r.active, 0) };
  }

  const byTypeDelivery = {};
  for (const r of deliveryRows) {
    const ct = normalizeChannelType(r.channel_type);
    byTypeDelivery[ct] = {
      outTotal: safeInt(r.out_total, 0),
      outFailed: safeInt(r.out_failed, 0),
      outSent: safeInt(r.out_sent, 0),
      outReceived: safeInt(r.out_received, 0),
      inTotal: safeInt(r.in_total, 0),
    };
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
      diagnostics: accountDiagnostics?.byChannel?.[ct] || undefined,
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
    accountDiagnostics: accountDiagnostics ? { byChannel: accountDiagnostics.byChannel || {}, totalAccounts: accountDiagnostics.accounts?.length || 0 } : undefined,
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
          try {
            logAction({
              agentId: 'system',
              username: 'system',
              tenantId,
              action: 'channel_health_alert',
              resource: 'channel',
              resourceId: a.channelType || null,
              details: { ...a },
              ipAddress: 'internal',
              userAgent: 'channelHealthMonitor',
            });
          } catch (_) {}
        }
      }
    } catch (err) {
      logger.warn('[ChannelHealth] Falha no monitor (ignorado)', { error: safeErrorMessage(err) });
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


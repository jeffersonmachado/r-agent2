'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');
const getWebPushSubscriptionModel = require('../../db/models/WebPushSubscription');

let webPushLib = null;
let vapidConfigured = false;

function getWebPushLib() {
  if (!webPushLib) {
    // Dependência opcional até o ambiente instalar `web-push`.
    // eslint-disable-next-line global-require
    webPushLib = require('web-push');
  }
  return webPushLib;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function getVapidPublicKey() {
  const value = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  return value || null;
}

function getVapidPrivateKey() {
  const value = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  return value || null;
}

function getVapidSubject() {
  return String(process.env.VAPID_SUBJECT || 'mailto:suporte@results.com.br').trim();
}

function validateWebPushStartupConfig() {
  const pub = getVapidPublicKey();
  const priv = getVapidPrivateKey();
  if (!pub && !priv) {
    logger.warn('[WebPush] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas. Web Push ficará desabilitado.');
    return;
  }
  if (!pub || !priv) {
    throw new Error('Web Push habilitado parcialmente. Defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.');
  }
}

function ensureWebPushConfigured() {
  const pub = getVapidPublicKey();
  const priv = getVapidPrivateKey();
  if (!pub || !priv) {
    throw new Error('Web Push não configurado. Defina VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.');
  }
  if (!vapidConfigured) {
    getWebPushLib().setVapidDetails(getVapidSubject(), pub, priv);
    vapidConfigured = true;
  }
}

function normalizeSubscription(input) {
  const sub = input && typeof input === 'object' ? input : null;
  const endpoint = String(sub?.endpoint || '').trim();
  const p256dh = String(sub?.keys?.p256dh || '').trim();
  const auth = String(sub?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error('subscription inválida: endpoint e keys(p256dh/auth) são obrigatórios');
  }
  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

function toPublicSubscriptionRow(row) {
  let subscription = null;
  try {
    subscription = JSON.parse(row.subscription_json);
  } catch {
    subscription = null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    endpoint: row.endpoint,
    subscription,
    userAgent: row.user_agent || null,
    deviceName: row.device_name || null,
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function subscribeWebPush({
  tenantId,
  userId,
  subscription,
  userAgent = null,
  deviceName = null,
}) {
  const Model = getWebPushSubscriptionModel();
  const normalized = normalizeSubscription(subscription);
  const now = new Date();
  const serialized = JSON.stringify(normalized);

  const existing = await Model.findOne({
    where: { endpoint: normalized.endpoint },
  });

  if (existing) {
    const updated = await existing.update({
      tenant_id: String(tenantId),
      user_id: String(userId),
      subscription_json: serialized,
      user_agent: userAgent ? String(userAgent) : null,
      device_name: deviceName ? String(deviceName) : null,
      last_seen_at: now,
      updated_at: now,
    });
    return toPublicSubscriptionRow(updated);
  }

  const created = await Model.create({
    id: newId('wps'),
    tenant_id: String(tenantId),
    user_id: String(userId),
    endpoint: normalized.endpoint,
    subscription_json: serialized,
    user_agent: userAgent ? String(userAgent) : null,
    device_name: deviceName ? String(deviceName) : null,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });
  return toPublicSubscriptionRow(created);
}

async function unsubscribeWebPush({ tenantId, userId, endpoint }) {
  const Model = getWebPushSubscriptionModel();
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) {
    throw new Error('endpoint é obrigatório');
  }
  const removed = await Model.destroy({
    where: {
      tenant_id: String(tenantId),
      user_id: String(userId),
      endpoint: normalizedEndpoint,
    },
  });
  return removed > 0;
}

async function listWebPushSubscriptionsForUser({ tenantId, userId }) {
  const Model = getWebPushSubscriptionModel();
  const rows = await Model.findAll({
    where: {
      tenant_id: String(tenantId),
      user_id: String(userId),
    },
    order: [['updated_at', 'DESC']],
    limit: 200,
  });
  return rows.map(toPublicSubscriptionRow);
}

async function removeWebPushSubscriptionByEndpoint(endpoint) {
  const Model = getWebPushSubscriptionModel();
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) return false;
  const removed = await Model.destroy({
    where: { endpoint: normalizedEndpoint },
  });
  return removed > 0;
}

async function sendWebPushToUser({
  tenantId,
  userId,
  title,
  body,
  data = {},
}) {
  ensureWebPushConfigured();

  const list = await listWebPushSubscriptionsForUser({ tenantId, userId });
  if (!list.length) {
    return { ok: true, sent: 0, failed: 0, invalidRemoved: 0 };
  }

  let sent = 0;
  let failed = 0;
  let invalidRemoved = 0;
  const payload = JSON.stringify({
    title: String(title || ''),
    body: String(body || ''),
    data: data && typeof data === 'object' ? data : {},
  });

  const webPush = getWebPushLib();
  for (const row of list) {
    try {
      const sub = normalizeSubscription(row.subscription);
      await webPush.sendNotification(sub, payload);
      sent += 1;
    } catch (err) {
      failed += 1;
      const statusCode = Number(err?.statusCode || 0);
      const isInvalid = statusCode === 404 || statusCode === 410;
      if (isInvalid) {
        const removed = await removeWebPushSubscriptionByEndpoint(row.endpoint);
        if (removed) invalidRemoved += 1;
      }
      logger.warn('[WebPush] Falha ao enviar notificação', {
        tenantId,
        userId,
        endpointHash: crypto.createHash('sha256').update(String(row.endpoint)).digest('hex').slice(0, 12),
        statusCode: statusCode || null,
        message: err?.message || 'unknown_error',
      });
    }
  }

  return {
    ok: failed === 0,
    sent,
    failed,
    invalidRemoved,
  };
}

module.exports = {
  getVapidPublicKey,
  validateWebPushStartupConfig,
  normalizeSubscription,
  subscribeWebPush,
  unsubscribeWebPush,
  listWebPushSubscriptionsForUser,
  sendWebPushToUser,
};

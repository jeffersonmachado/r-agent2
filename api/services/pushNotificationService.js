'use strict';

/**
 * Push Notification Service — Web Push (VAPID) para o PWA.
 *
 * Envia notificações de novas mensagens do Inbox para os dispositivos
 * inscritos dos usuários do tenant. Persistência obrigatória (sem fallback
 * em memória). Configuração via env:
 *   WEBPUSH_VAPID_PUBLIC_KEY / WEBPUSH_VAPID_PRIVATE_KEY / WEBPUSH_SUBJECT
 *
 * FAIL-CLOSED de configuração: sem chaves VAPID, isConfigured() === false,
 * o endpoint de public-key responde 503 (o frontend já trata) e o envio
 * é pulado com log — nunca derruba o fluxo de mensagens.
 *
 * Higiene: respostas 404/410 do push service removem a inscrição expirada.
 */

const crypto = require('crypto');
const webpush = require('web-push');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { PushSubscription } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function vapidConfig() {
  const publicKey = String(process.env.WEBPUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEBPUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.WEBPUSH_SUBJECT || 'mailto:suporte@r-agent2.local').trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function isConfigured() {
  return vapidConfig() !== null;
}

function publicKey() {
  const cfg = vapidConfig();
  return cfg ? cfg.publicKey : null;
}

/**
 * Inscreve (ou atualiza) um dispositivo. Upsert por tenant+endpoint.
 */
async function subscribe({ tenantId, userId, subscription, deviceName = null, userAgent = null }) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para inscrição de push');
  const endpoint = String(subscription?.endpoint || '').trim();
  const keys = subscription?.keys && typeof subscription.keys === 'object' ? subscription.keys : null;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw Object.assign(new Error('subscription inválida: endpoint/keys obrigatórios'), { code: 'validation_error' });
  }

  const Model = PushSubscription();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId), endpoint } }).catch(() => null);
  if (existing) {
    await existing.update({
      user_id: String(userId),
      keys,
      device_name: deviceName || existing.device_name,
      user_agent: userAgent || existing.user_agent,
    });
    return existing.toJSON ? existing.toJSON() : existing;
  }
  const row = await Model.create({
    id: makeId('psub'),
    tenant_key: String(tenantId),
    user_id: String(userId),
    endpoint,
    keys,
    device_name: deviceName,
    user_agent: userAgent,
  });
  return row && row.toJSON ? row.toJSON() : row;
}

async function unsubscribe({ tenantId, endpoint }) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para remoção de inscrição');
  const Model = PushSubscription();
  const removed = await Model.destroy({ where: { tenant_key: String(tenantId), endpoint: String(endpoint || '') } }).catch(() => 0);
  return { removed: Number(removed) || 0 };
}

async function listUserSubscriptions({ tenantId, userId }) {
  if (!dbAvailable()) return [];
  const rows = await PushSubscription().findAll({
    where: { tenant_key: String(tenantId), user_id: String(userId) },
    limit: 50,
  }).catch(() => []);
  return (rows || []).map((r) => (r.toJSON ? r.toJSON() : r));
}

/**
 * Envia payload para todas as inscrições de um usuário.
 * Inscrições expiradas (404/410) são removidas.
 * @returns {Promise<{sent: number, removed: number, skipped: boolean}>}
 */
async function sendToUser({ tenantId, userId, payload }) {
  const cfg = vapidConfig();
  if (!cfg) {
    logger.warn('[Push] VAPID não configurado — envio pulado', { tenantId, userId });
    return { sent: 0, removed: 0, skipped: true };
  }
  const subs = await listUserSubscriptions({ tenantId, userId });
  if (subs.length === 0) return { sent: 0, removed: 0, skipped: false };

  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  const body = JSON.stringify(payload || {});
  let sent = 0;
  let removed = 0;
  const Model = PushSubscription();

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 300 },
      );
      sent += 1;
    } catch (err) {
      const status = Number(err?.statusCode) || 0;
      if (status === 404 || status === 410) {
        await Model.destroy({ where: { tenant_key: String(tenantId), endpoint: sub.endpoint } }).catch(() => 0);
        removed += 1;
      } else {
        logger.warn('[Push] falha ao enviar', { tenantId, userId, status, error: err?.message });
      }
    }
  }
  return { sent, removed, skipped: false };
}

/**
 * Envia para todos os usuários inscritos do tenant (ex.: nova mensagem no
 * Inbox sem atribuição específica).
 */
async function sendToTenant({ tenantId, payload, excludeUserIds = [] }) {
  const cfg = vapidConfig();
  if (!cfg) return { sent: 0, removed: 0, skipped: true };
  if (!dbAvailable()) return { sent: 0, removed: 0, skipped: false };
  const excluded = new Set((excludeUserIds || []).map(String));
  const rows = await PushSubscription().findAll({
    where: { tenant_key: String(tenantId) },
    attributes: ['user_id'],
    limit: 1000,
  }).catch(() => []);
  const userIds = Array.from(new Set((rows || []).map((r) => {
    const d = r.toJSON ? r.toJSON() : r;
    return String(d.user_id);
  }))).filter((id) => !excluded.has(id));

  let sent = 0;
  let removed = 0;
  for (const userId of userIds) {
    const result = await sendToUser({ tenantId, userId, payload });
    sent += result.sent;
    removed += result.removed;
  }
  return { sent, removed, skipped: false };
}

module.exports = {
  isConfigured,
  publicKey,
  subscribe,
  unsubscribe,
  listUserSubscriptions,
  sendToUser,
  sendToTenant,
};

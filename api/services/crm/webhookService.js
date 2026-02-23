'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * CRM Webhooks Service
 * Manages webhook registration, dispatch, and retry logic
 */

async function registerWebhook(sequelize, tenantKey, webhookData) {
  const CrmWebhook = sequelize.models.CrmWebhook;

  const secret = crypto.randomBytes(32).toString('hex');

  return CrmWebhook.create({
    id: uuidv4(),
    tenant_key: tenantKey,
    name: webhookData.name,
    url: webhookData.url,
    events: webhookData.events || [],
    headers: webhookData.headers || {},
    retry_attempts: webhookData.retry_attempts || 3,
    retry_interval_seconds: webhookData.retry_interval_seconds || 60,
    active: webhookData.active !== false,
    secret,
  });
}

async function listWebhooks(sequelize, tenantKey) {
  const CrmWebhook = sequelize.models.CrmWebhook;

  return CrmWebhook.findAll({
    where: { tenant_key: tenantKey },
    attributes: { exclude: ['secret'] },
    order: [['created_at', 'DESC']],
  });
}

async function deleteWebhook(sequelize, tenantKey, webhookId) {
  const CrmWebhook = sequelize.models.CrmWebhook;

  return CrmWebhook.destroy({
    where: { id: webhookId, tenant_key: tenantKey },
  });
}

async function triggerWebhookEvent(sequelize, tenantKey, eventType, payload) {
  const CrmWebhook = sequelize.models.CrmWebhook;
  const CrmWebhookQueue = sequelize.models.CrmWebhookQueue;

  // Find webhooks subscribed to this event
  const webhooks = await CrmWebhook.findAll({
    where: {
      tenant_key: tenantKey,
      active: true,
      events: {
        [sequelize.Sequelize.Op.contains]: [eventType],
      },
    },
  });

  // Queue webhook deliveries
  const queuedEvents = [];
  for (const webhook of webhooks) {
    const queuedEvent = await CrmWebhookQueue.create({
      id: uuidv4(),
      tenant_key: tenantKey,
      webhook_id: webhook.id,
      event: eventType,
      payload,
      status: 'pending',
    });
    queuedEvents.push(queuedEvent);
  }

  return queuedEvents;
}

async function processWebhookQueue(sequelize) {
  const CrmWebhookQueue = sequelize.models.CrmWebhookQueue;
  const CrmWebhook = sequelize.models.CrmWebhook;

  // Find pending or retry events
  const pendingEvents = await CrmWebhookQueue.findAll({
    where: {
      status: { [sequelize.Sequelize.Op.in]: ['pending', 'retry'] },
      next_retry_at: { [sequelize.Sequelize.Op.lte]: new Date() },
    },
    limit: 100,
  });

  for (const event of pendingEvents) {
    const webhook = await CrmWebhook.findByPk(event.webhook_id);

    if (!webhook) {
      await event.update({ status: 'failed', error_message: 'Webhook not found' });
      continue;
    }

    try {
      await deliverWebhook(event, webhook);
      await event.update({
        status: 'success',
        attempts: event.attempts + 1,
        last_attempted_at: new Date(),
      });
    } catch (err) {
      const nextAttempt = event.attempts + 1;

      if (nextAttempt >= webhook.retry_attempts) {
        await event.update({
          status: 'failed',
          attempts: nextAttempt,
          error_message: err.message,
          last_attempted_at: new Date(),
        });
      } else {
        const nextRetryAt = new Date();
        nextRetryAt.setSeconds(nextRetryAt.getSeconds() + webhook.retry_interval_seconds);

        await event.update({
          status: 'retry',
          attempts: nextAttempt,
          error_message: err.message,
          last_attempted_at: new Date(),
          next_retry_at: nextRetryAt,
        });
      }
    }
  }
}

async function deliverWebhook(event, webhook) {
  const timestamp = Date.now();
  const signature = generateSignature(event.payload, webhook.secret, timestamp);

  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Timestamp': timestamp.toString(),
    'X-Webhook-Event': event.event,
    ...webhook.headers,
  };

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: event.event,
      timestamp,
      data: event.payload,
    }),
    timeout: 30000,
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed with status ${response.status}`);
  }

  return response.json();
}

function generateSignature(payload, secret, timestamp) {
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  return crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

function verifyWebhookSignature(payload, signature, secret, timestamp) {
  const expectedSignature = generateSignature(payload, secret, timestamp);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

module.exports = {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  triggerWebhookEvent,
  processWebhookQueue,
  deliverWebhook,
  generateSignature,
  verifyWebhookSignature,
};

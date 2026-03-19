'use strict';

/**
 * Notification Adapter Layer
 *
 * Provides a unified, channel-agnostic interface for sending notifications
 * from vertical journey automations (Beauty and Fitness).
 *
 * Design principles:
 * - Pluggable: each channel is a named adapter; new channels extend the registry
 * - Transparent: stubs return real status objects, never silently pretend to send
 * - Safe: no external HTTP calls made unless the adapter is explicitly configured
 * - Multi-tenant: tenantId drives channel selection from tenant settings
 *
 * Current adapters:
 *   whatsapp  → stub (pluggable via whatsappService or bulkMessagingService)
 *   sms       → stub
 *   email     → stub
 *   internal  → no-op (in-app / operational only)
 *
 * To activate a channel in production:
 *   1. Set env var NOTIFICATION_<CHANNEL>_ENABLED=true
 *   2. Provide the channel-specific config (see individual adapters below)
 *
 * Usage:
 *   const adapter = require('./notificationAdapter');
 *   await adapter.sendJourneyNotification({ tenantId, channel, subjectId, eventType, payload });
 */

const logger = require('../../utils/logger');
const { appendEventV1 } = require('../eventLedgerService');

// ── constants ─────────────────────────────────────────────────────────────────

const CHANNEL_STATUS = {
  SENT: 'sent',
  STUB: 'stub',
  DISABLED: 'disabled',
  SKIPPED: 'skipped',
  ERROR: 'error',
};

function maskRecipient(value) {
  const text = String(value || '');
  if (!text) return '-';
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    if (!domain) return '***';
    const maskedName = name.length <= 2 ? `${name[0] || '*'}*` : `${name.slice(0, 2)}***`;
    return `${maskedName}@${domain}`;
  }
  if (text.length <= 4) return `${text[0] || '*'}***`;
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function toDashboardStatus(result = {}) {
  const status = String(result.status || '').toLowerCase();
  if (status === CHANNEL_STATUS.SENT) return 'sent';
  if (status === CHANNEL_STATUS.ERROR) return 'failed';
  if (status === CHANNEL_STATUS.SKIPPED) return 'skipped';
  return 'provider-dependent';
}

async function logNotificationDelivery({ tenantId, channel, recipient, eventType, result, subjectId = null, membershipId = null, payload = {} }) {
  try {
    await appendEventV1({
      tenantId,
      type: 'VerticalJourney_Custom',
      source: `vertical.notification.${channel || 'internal'}`,
      occurredAt: new Date(),
      correlationId: membershipId || subjectId || recipient || null,
      subject: { type: 'journey_notification', id: subjectId || membershipId || recipient || 'unknown' },
      actor: { type: 'system', id: 'notification_adapter' },
      payload: {
        kind: 'notification_delivery',
        eventType,
        channel,
        dashboardStatus: toDashboardStatus(result),
        adapterStatus: result?.status || null,
        isStub: !!result?.isStub,
        destinationMasked: maskRecipient(recipient),
        destination: recipient || null,
        error: result?.error || null,
        vertical: payload?.vertical || null,
        payload,
      },
    });
  } catch (_) {
    // Best-effort: notification delivery must not fail because of observability event.
  }
}

// Message templates by journey event type
const EVENT_TEMPLATES = {
  confirmation_sent: 'Olá! Seu agendamento foi confirmado. Até logo! 😊',
  reminder_24h: 'Lembrete: você tem um agendamento amanhã. Não esqueça! ✨',
  reminder_1h: 'Seu atendimento é em breve. Estamos esperando você! 🕐',
  no_show_detected: 'Sentimos a sua falta! Que tal remarcar um horário conveniente?',
  follow_up_sent: 'Obrigado pela sua visita! Como foi sua experiência?',
  reactivation_sent: 'Sentimos sua falta! Que tal agendar seu próximo horário? Temos novidades para você. 💆‍♀️',
  return_campaign_sent: 'Venha nos visitar! Temos uma oferta especial esperando por você. 🏋️',
  frequency_alert_sent: 'Estamos notando que você não vem tanto ultimamente. Que tal manter sua rotina? 💪',
  welcome_sent: 'Bem-vindo(a)! Estamos felizes em tê-lo(a) como membro. Qualquer dúvida, é só falar! 🎉',
};

// ── Channel adapters ──────────────────────────────────────────────────────────

/**
 * WhatsApp adapter (stub / real via whatsappService).
 * To activate: set NOTIFICATION_WHATSAPP_ENABLED=true and configure whatsappService.
 */
async function sendWhatsApp({ tenantId, to, message, metadata = {} }) {
  const enabled = process.env.NOTIFICATION_WHATSAPP_ENABLED === 'true';
  if (!enabled) {
    logger.debug('[NotificationAdapter][WhatsApp] STUB – channel disabled; set NOTIFICATION_WHATSAPP_ENABLED=true to activate', { tenantId, to: String(to).slice(0, 6) + '***' });
    return { status: CHANNEL_STATUS.STUB, channel: 'whatsapp', isStub: true, to, message };
  }

  // Production hook: inject by requiring whatsappService
  try {
    const { sendWhatsappMessage } = require('../whatsappService');
    const result = await sendWhatsappMessage({ tenantId, to, message, metadata });
    return { status: CHANNEL_STATUS.SENT, channel: 'whatsapp', to, result };
  } catch (err) {
    logger.warn('[NotificationAdapter][WhatsApp] send failed', { tenantId, error: err?.message });
    return { status: CHANNEL_STATUS.ERROR, channel: 'whatsapp', error: err?.message };
  }
}

/**
 * SMS adapter (stub).
 * To activate: set NOTIFICATION_SMS_ENABLED=true and provide SMS service.
 */
async function sendSms({ tenantId, to, message }) {
  const enabled = process.env.NOTIFICATION_SMS_ENABLED === 'true';
  if (!enabled) {
    logger.debug('[NotificationAdapter][SMS] STUB – channel disabled; set NOTIFICATION_SMS_ENABLED=true to activate', { tenantId });
    return { status: CHANNEL_STATUS.STUB, channel: 'sms', isStub: true, to, message };
  }
  // Production hook: implement SMS provider here
  logger.warn('[NotificationAdapter][SMS] enabled but no provider configured', { tenantId });
  return { status: CHANNEL_STATUS.DISABLED, channel: 'sms', reason: 'no_provider_configured' };
}

/**
 * Email adapter (stub).
 * To activate: set NOTIFICATION_EMAIL_ENABLED=true and provide SMTP/provider config.
 */
async function sendEmail({ tenantId, to, subject, body }) {
  const enabled = process.env.NOTIFICATION_EMAIL_ENABLED === 'true';
  if (!enabled) {
    logger.debug('[NotificationAdapter][Email] STUB – channel disabled; set NOTIFICATION_EMAIL_ENABLED=true to activate', { tenantId });
    return { status: CHANNEL_STATUS.STUB, channel: 'email', isStub: true, to, subject };
  }
  // Production hook: implement email provider here
  logger.warn('[NotificationAdapter][Email] enabled but no provider configured', { tenantId });
  return { status: CHANNEL_STATUS.DISABLED, channel: 'email', reason: 'no_provider_configured' };
}

/**
 * Internal: no-op (in-app notification or operational log).
 */
async function sendInternal({ tenantId, subjectId, eventType, payload }) {
  logger.debug('[NotificationAdapter][Internal] journey event recorded', { tenantId, subjectId, eventType });
  return { status: CHANNEL_STATUS.SKIPPED, channel: 'internal' };
}

// ── Unified send ──────────────────────────────────────────────────────────────

/**
 * Send a journey notification through the appropriate channel.
 *
 * @param {object} params
 * @param {string}  params.tenantId
 * @param {string}  params.channel         'whatsapp'|'sms'|'email'|'internal'
 * @param {string}  [params.subjectId]     internal subject reference
 * @param {string}  [params.customerId]    external customer ref (may be a phone / email)
 * @param {string}  [params.membershipId]
 * @param {string}  params.eventType       journey event type (for template lookup)
 * @param {object}  [params.payload]       extra context
 * @returns {Promise<object>} delivery status object
 */
async function sendJourneyNotification({
  tenantId,
  channel = 'internal',
  subjectId = null,
  customerId = null,
  membershipId = null,
  eventType,
  payload = {},
}) {
  const template = EVENT_TEMPLATES[eventType] || `Journey event: ${eventType}`;

  // Resolve recipient address: prefer customerId (external), fallback to subjectId
  const recipient = customerId || subjectId || 'unknown';

  let result;

  try {
    switch (channel) {
      case 'whatsapp':
        result = await sendWhatsApp({ tenantId, to: recipient, message: template, metadata: { eventType, ...payload } });
        break;

      case 'sms':
        result = await sendSms({ tenantId, to: recipient, message: template });
        break;

      case 'email':
        result = await sendEmail({
          tenantId,
          to: recipient,
          subject: `[${eventType.replace(/_/g, ' ')}]`,
          body: template,
        });
        break;

      case 'internal':
      default:
        result = await sendInternal({ tenantId, subjectId, eventType, payload });
        break;
    }

    await logNotificationDelivery({
      tenantId,
      channel,
      recipient,
      eventType,
      result,
      subjectId,
      membershipId,
      payload,
    });

    return result;
  } catch (err) {
    logger.warn('[NotificationAdapter] unexpected error in sendJourneyNotification', {
      tenantId, channel, eventType, error: err?.message,
    });
    const failed = { status: CHANNEL_STATUS.ERROR, channel, error: err?.message };

    await logNotificationDelivery({
      tenantId,
      channel,
      recipient,
      eventType,
      result: failed,
      subjectId,
      membershipId,
      payload,
    });

    return failed;
  }
}

/**
 * Broadcast a notification through multiple channels.
 * channel array may include 'whatsapp', 'sms', 'email', 'internal'
 */
async function broadcastJourneyNotification({ tenantId, channels = ['internal'], ...rest }) {
  const results = await Promise.all(
    channels.map((ch) => sendJourneyNotification({ tenantId, channel: ch, ...rest }).catch((err) => ({
      status: CHANNEL_STATUS.ERROR, channel: ch, error: err?.message,
    }))),
  );
  return { channels: results };
}

module.exports = {
  CHANNEL_STATUS,
  EVENT_TEMPLATES,
  sendJourneyNotification,
  broadcastJourneyNotification,
  // individual adapters (for testing / mocking)
  sendWhatsApp,
  sendSms,
  sendEmail,
  sendInternal,
};

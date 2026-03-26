'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { getSequelize } = require('../db/sequelize');
const { NotificationDelivery, AccessSubject } = require('../db/models');
const { appendEventV1 } = require('./eventLedgerService');
const { sendTextMessage } = require('./whatsappService');
const { enqueueJob } = require('./executionQueueService');

const DEFAULT_CHANNEL = 'whatsapp';
const DEFAULT_MAX_ATTEMPTS = 3;
const DISPATCH_JOB_KIND = 'vertical_notification_dispatch';

const DELIVERY_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  STUB: 'stub',
};

const DEFAULT_TEMPLATES = {
  reminder_24h: 'Lembrete: seu agendamento e amanha. Responda esta mensagem se precisar remarcar.',
  reminder_1h: 'Seu agendamento e em breve. Estamos te esperando.',
  no_show_detected: 'Sentimos sua falta hoje. Quer que a gente reagende para voce?',
  reactivation_sent: 'Faz tempo que nao te vemos. Temos novidades para seu retorno.',
  return_campaign_sent: 'Notamos sua baixa frequencia. Quer ajuda para retomar sua rotina?',
  frequency_alert_sent: 'Voce treinou menos nas ultimas semanas. Vamos montar um plano de retomada?',
  billing_charge_created: 'Sua cobranca foi gerada. Se precisar, enviamos uma nova via.',
  billing_overdue: 'Sua cobranca esta em atraso. Regularize para manter os beneficios ativos.',
  billing_confirmed: 'Pagamento confirmado. Seu acesso foi atualizado.',
  confirmation_sent: 'Seu agendamento foi confirmado. Ate logo.',
  follow_up_sent: 'Obrigado pela sua visita. Como foi sua experiencia?',
  welcome_sent: 'Bem-vindo(a). Estamos felizes em ter voce conosco.',
};

function dbAvailable() {
  return !!getSequelize();
}

function deliveryModel() {
  if (typeof NotificationDelivery !== 'function') return null;
  try {
    return NotificationDelivery();
  } catch (_) {
    return null;
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function maskRecipient(value) {
  const text = safeString(value, '');
  if (!text) return '-';
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    const safeName = name || '*';
    const maskedName = safeName.length <= 2 ? `${safeName[0] || '*'}*` : `${safeName.slice(0, 2)}***`;
    return `${maskedName}@${domain || '***'}`;
  }
  if (text.length <= 4) return `${text[0] || '*'}***`;
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function normalizeChannel(channel) {
  const value = safeString(channel, DEFAULT_CHANNEL).trim().toLowerCase();
  if (['whatsapp', 'sms', 'email', 'internal'].includes(value)) return value;
  return DEFAULT_CHANNEL;
}

function resolveTemplate(eventType, customMessage) {
  if (customMessage) return safeString(customMessage);
  return DEFAULT_TEMPLATES[safeString(eventType)] || `Atualizacao: ${safeString(eventType, 'evento')}`;
}

function isPhoneLike(value) {
  const cleaned = safeString(value).replace(/[^\d]/g, '');
  return cleaned.length >= 10;
}

function isEmailLike(value) {
  return safeString(value).includes('@');
}

function shouldTreatAsResolvedRecipient(value, channel) {
  const normalizedChannel = normalizeChannel(channel);
  if (normalizedChannel === 'email') return isEmailLike(value);
  if (normalizedChannel === 'internal') return !!safeString(value);
  return isPhoneLike(value);
}

async function resolveRecipientFromSubject({ tenantId, subjectId = null, customerId = null, channel }) {
  if (!dbAvailable() || typeof AccessSubject !== 'function') return null;
  if (!subjectId && !customerId) return null;

  const model = AccessSubject();
  const row = await model.findOne({
    where: subjectId && customerId
      ? { tenant_key: tenantId, id: subjectId, customer_id: customerId }
      : subjectId
        ? { tenant_key: tenantId, id: subjectId }
        : { tenant_key: tenantId, customer_id: customerId },
  }).catch(() => null);
  const subject = row && row.toJSON ? row.toJSON() : row;
  const metadata = subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
  if (normalizeChannel(channel) === 'email') {
    return metadata.email || null;
  }
  return metadata.phone || metadata.whatsapp || metadata.mobilePhone || null;
}

function readChannelEnabled(channel) {
  const configured = config.getFromFile(`notifications.${channel}.enabled`, undefined);
  if (typeof configured === 'boolean') return configured;
  if (channel === 'internal') return true;
  if (channel === 'whatsapp') return true;
  return false;
}

async function logDeliveryEvent(delivery, result = {}) {
  if (!dbAvailable()) return;

  await appendEventV1({
    tenantId: delivery.tenant_key,
    type: 'VerticalJourney_Custom',
    source: `vertical.notification.${delivery.channel || DEFAULT_CHANNEL}`,
    occurredAt: new Date(),
    correlationId: delivery.id,
    subject: { type: 'journey_notification', id: delivery.id },
    actor: { type: 'system', id: 'notification_service' },
    idempotencyKey: `notification_delivery_log:${delivery.id}:${delivery.attempts || 0}:${result.status || delivery.status}`,
    payload: {
      kind: 'notification_delivery',
      notificationId: delivery.id,
      executionJobId: delivery.execution_job_id || null,
      eventType: delivery.event_type,
      channel: delivery.channel,
      dashboardStatus: result.dashboardStatus || result.status || delivery.status,
      deliveryStatus: result.status || delivery.status,
      providerStatus: result.providerStatus || null,
      isStub: !!result.isStub,
      destination: delivery.recipient_resolved || delivery.recipient || null,
      destinationMasked: delivery.recipient_masked || maskRecipient(delivery.recipient_resolved || delivery.recipient || ''),
      error: result.error || delivery.last_error || null,
      attempt: delivery.attempts || 0,
      vertical: delivery.vertical || null,
      subjectId: delivery.subject_id || null,
      customerId: delivery.customer_id || null,
      membershipId: delivery.membership_id || null,
      bundleId: delivery.bundle_id || null,
      transactionId: delivery.transaction_id || null,
      appointmentId: delivery.appointment_id || null,
      scheduleId: delivery.schedule_id || null,
      metadata: delivery.metadata || {},
    },
  }).catch(() => {});
}

function coerceDelivery(row) {
  return row && row.toJSON ? row.toJSON() : row;
}

async function createDeliveryRecord(input) {
  if (!dbAvailable()) return null;
  const Model = deliveryModel();
  if (!Model) return null;

  const now = new Date();
  const rowPayload = {
    id: makeId('notif'),
    tenant_key: input.tenantId,
    vertical: input.vertical || null,
    subject_id: input.subjectId || null,
    customer_id: input.customerId || null,
    membership_id: input.membershipId || null,
    bundle_id: input.bundleId || null,
    transaction_id: input.transactionId || null,
    appointment_id: input.appointmentId || null,
    schedule_id: input.scheduleId || null,
    execution_job_id: null,
    event_type: input.eventType,
    template_key: input.templateKey || input.eventType || null,
    channel: input.channel,
    recipient: input.recipient || null,
    recipient_resolved: input.recipientResolved || null,
    recipient_masked: maskRecipient(input.recipientResolved || input.recipient || ''),
    message: input.message,
    provider: input.provider || null,
    provider_message_id: null,
    status: DELIVERY_STATUS.PENDING,
    attempts: 0,
    max_attempts: input.maxAttempts,
    last_attempt_at: null,
    sent_at: null,
    last_error: null,
    idempotency_key: input.idempotencyKey || null,
    metadata: input.metadata || {},
    created_at: now,
    updated_at: now,
  };

  const row = await Model.create(rowPayload).catch(async (err) => {
    const isUnique = safeString(err?.original?.code || err?.code) === '23505'
      || safeString(err?.name).toLowerCase().includes('unique')
      || safeString(err?.message).toLowerCase().includes('unique');
    if (rowPayload.idempotency_key && isUnique) {
      return Model.findOne({
        where: {
          tenant_key: rowPayload.tenant_key,
          idempotency_key: rowPayload.idempotency_key,
        },
      }).catch(() => null);
    }
    throw err;
  });

  return coerceDelivery(row);
}

async function getDeliveryById({ tenantId, notificationId }) {
  if (!dbAvailable()) return null;
  const Model = deliveryModel();
  if (!Model) return null;
  const row = await Model.findOne({
    where: {
      tenant_key: tenantId,
      id: safeString(notificationId),
    },
  }).catch(() => null);
  return coerceDelivery(row);
}

async function updateDelivery(delivery, patch) {
  if (!dbAvailable()) return { ...delivery, ...patch };
  const Model = deliveryModel();
  if (!Model) return { ...delivery, ...patch };
  const row = await Model.findOne({
    where: { tenant_key: delivery.tenant_key, id: delivery.id },
  }).catch(() => null);
  if (!row) return { ...delivery, ...patch };
  await row.update(patch).catch(() => {});
  return coerceDelivery(row);
}

async function buildCanonicalDeliveryInput({
  tenantId,
  recipient = null,
  to = null,
  channel = DEFAULT_CHANNEL,
  eventType,
  message = null,
  templateKey = null,
  metadata = {},
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  vertical = null,
  subjectId = null,
  customerId = null,
  membershipId = null,
  bundleId = null,
  transactionId = null,
  appointmentId = null,
  scheduleId = null,
  idempotencyKey = null,
}) {
  const normalizedChannel = normalizeChannel(channel || metadata.channel || DEFAULT_CHANNEL);
  const rawRecipient = recipient || to || metadata.recipient || metadata.to || customerId || subjectId || null;
  const resolvedRecipient = shouldTreatAsResolvedRecipient(rawRecipient, normalizedChannel)
    ? rawRecipient
    : await resolveRecipientFromSubject({ tenantId, subjectId, customerId, channel: normalizedChannel });

  const resolvedIdempotencyKey = idempotencyKey
    || metadata.idempotencyKey
    || [
      'notif',
      tenantId,
      normalizedChannel,
      eventType,
      scheduleId || appointmentId || transactionId || membershipId || bundleId || customerId || subjectId || rawRecipient || 'na',
    ].join(':');

  return {
    tenantId,
    channel: normalizedChannel,
    eventType: safeString(eventType),
    templateKey: templateKey || eventType || null,
    message: resolveTemplate(eventType, message || metadata.message || null),
    recipient: rawRecipient,
    recipientResolved: resolvedRecipient || rawRecipient || null,
    metadata,
    maxAttempts: Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS),
    vertical: vertical || metadata.vertical || null,
    subjectId: subjectId || metadata.subjectId || null,
    customerId: customerId || metadata.customerId || null,
    membershipId: membershipId || metadata.membershipId || null,
    bundleId: bundleId || metadata.bundleId || null,
    transactionId: transactionId || metadata.transactionId || null,
    appointmentId: appointmentId || metadata.appointmentId || null,
    scheduleId: scheduleId || metadata.scheduleId || null,
    idempotencyKey: resolvedIdempotencyKey,
    provider: normalizedChannel === 'whatsapp' ? 'whatsapp_cloud_api' : normalizedChannel,
  };
}

async function queueNotification(params = {}) {
  const canonical = await buildCanonicalDeliveryInput(params);
  if (!canonical.tenantId || !canonical.eventType) {
    const err = new Error('notification_validation_error');
    err.code = 'notification_validation_error';
    throw err;
  }

  const delivery = await createDeliveryRecord(canonical);
  const persisted = delivery || {
    id: makeId('notif'),
    tenant_key: canonical.tenantId,
    event_type: canonical.eventType,
    channel: canonical.channel,
    recipient: canonical.recipient,
    recipient_resolved: canonical.recipientResolved,
    recipient_masked: maskRecipient(canonical.recipientResolved || canonical.recipient || ''),
    message: canonical.message,
    status: DELIVERY_STATUS.PENDING,
    attempts: 0,
    max_attempts: canonical.maxAttempts,
    metadata: canonical.metadata || {},
    vertical: canonical.vertical || null,
    subject_id: canonical.subjectId || null,
    customer_id: canonical.customerId || null,
    membership_id: canonical.membershipId || null,
    bundle_id: canonical.bundleId || null,
    transaction_id: canonical.transactionId || null,
    appointment_id: canonical.appointmentId || null,
    schedule_id: canonical.scheduleId || null,
    idempotency_key: canonical.idempotencyKey,
  };

  await enqueueJob({
    tenantId: canonical.tenantId,
    kind: DISPATCH_JOB_KIND,
    payload: {
      tenantId: canonical.tenantId,
      notificationId: persisted.id,
      force: false,
    },
    runAt: new Date(),
    priority: 1,
    maxAttempts: canonical.maxAttempts,
    idempotencyKey: `notif_job:${persisted.id}`,
  });

  return { item: persisted, queued: true };
}

async function enqueueNotification(params = {}) {
  return queueNotification(params);
}

async function performChannelSend(delivery) {
  const channel = normalizeChannel(delivery.channel);
  const recipient = delivery.recipient_resolved || delivery.recipient || null;
  const enabled = readChannelEnabled(channel);

  if (channel === 'internal') {
    return { status: DELIVERY_STATUS.SKIPPED, dashboardStatus: 'skipped', providerStatus: 'internal_noop', isStub: false };
  }

  if (!recipient) {
    return { status: DELIVERY_STATUS.FAILED, dashboardStatus: 'failed', error: 'missing_recipient' };
  }

  if (!enabled) {
    return { status: DELIVERY_STATUS.STUB, dashboardStatus: 'provider-dependent', providerStatus: 'channel_disabled', isStub: true };
  }

  if (channel === 'whatsapp') {
    const providerResult = await sendTextMessage(safeString(recipient), safeString(delivery.message));
    return {
      status: DELIVERY_STATUS.SENT,
      dashboardStatus: 'sent',
      providerStatus: 'sent',
      providerResult,
      providerMessageId: providerResult?.messages?.[0]?.id || providerResult?.message_id || null,
    };
  }

  return {
    status: DELIVERY_STATUS.FAILED,
    dashboardStatus: 'failed',
    error: `${channel}_provider_not_implemented`,
  };
}

async function dispatchNotification({
  tenantId,
  notificationId = null,
  jobId = null,
  force = false,
  fallbackPayload = null,
}) {
  let delivery = notificationId ? await getDeliveryById({ tenantId, notificationId }) : null;

  if (!delivery && fallbackPayload) {
    const created = await createDeliveryRecord(await buildCanonicalDeliveryInput(fallbackPayload));
    delivery = created || {
      id: makeId('notif'),
      tenant_key: tenantId,
      event_type: fallbackPayload.eventType,
      channel: normalizeChannel(fallbackPayload.channel),
      recipient: fallbackPayload.recipient || fallbackPayload.to || null,
      recipient_resolved: fallbackPayload.recipient || fallbackPayload.to || null,
      recipient_masked: maskRecipient(fallbackPayload.recipient || fallbackPayload.to || ''),
      message: resolveTemplate(fallbackPayload.eventType, fallbackPayload.message),
      status: DELIVERY_STATUS.PENDING,
      attempts: 0,
      max_attempts: Number(fallbackPayload.maxAttempts) || DEFAULT_MAX_ATTEMPTS,
      metadata: fallbackPayload.metadata || {},
      vertical: fallbackPayload.vertical || null,
      subject_id: fallbackPayload.subjectId || null,
      customer_id: fallbackPayload.customerId || null,
      membership_id: fallbackPayload.membershipId || null,
      bundle_id: fallbackPayload.bundleId || null,
      transaction_id: fallbackPayload.transactionId || null,
      appointment_id: fallbackPayload.appointmentId || null,
      schedule_id: fallbackPayload.scheduleId || null,
    };
  }

  if (!delivery) {
    return { ok: false, error: 'notification_not_found' };
  }

  if (!force && [DELIVERY_STATUS.SENT, DELIVERY_STATUS.SKIPPED].includes(delivery.status)) {
    return { ok: true, delivery, deduplicated: true };
  }

  const processingPatch = {
    status: DELIVERY_STATUS.PROCESSING,
    execution_job_id: jobId || delivery.execution_job_id || null,
    recipient_masked: maskRecipient(delivery.recipient_resolved || delivery.recipient || ''),
  };
  delivery = await updateDelivery(delivery, processingPatch);

  let result;
  try {
    result = await performChannelSend(delivery);
  } catch (err) {
    result = {
      status: DELIVERY_STATUS.FAILED,
      dashboardStatus: 'failed',
      error: err?.message || 'notification_send_failed',
    };
  }

  const nextAttempts = Number(delivery.attempts || 0) + 1;
  const patch = {
    status: result.status,
    attempts: nextAttempts,
    execution_job_id: jobId || delivery.execution_job_id || null,
    provider_message_id: result.providerMessageId || delivery.provider_message_id || null,
    last_attempt_at: new Date(),
    sent_at: result.status === DELIVERY_STATUS.SENT ? new Date() : delivery.sent_at || null,
    last_error: result.error || null,
    recipient_resolved: delivery.recipient_resolved || delivery.recipient || null,
    recipient_masked: maskRecipient(delivery.recipient_resolved || delivery.recipient || ''),
  };
  delivery = await updateDelivery(delivery, patch);
  await logDeliveryEvent(delivery, result);

  if (result.status === DELIVERY_STATUS.FAILED) {
    logger.warn('[NotificationService] envio falhou', {
      tenantId,
      notificationId: delivery.id,
      eventType: delivery.event_type,
      channel: delivery.channel,
      attempts: delivery.attempts,
      error: result.error,
    });
    return { ok: false, error: result.error || 'notification_send_failed', delivery };
  }

  return { ok: true, delivery, result };
}

async function sendJourneyNotification(params = {}) {
  const tenantId = safeString(params.tenantId);
  if (!tenantId) {
    const err = new Error('tenant_required');
    err.code = 'tenant_required';
    throw err;
  }

  if (params.notificationId) {
    return dispatchNotification({
      tenantId,
      notificationId: params.notificationId,
      jobId: params.jobId || null,
      force: !!params.force,
    });
  }

  const queued = await queueNotification(params);
  return dispatchNotification({
    tenantId,
    notificationId: queued.item?.id || null,
    jobId: params.jobId || null,
    force: !!params.force,
    fallbackPayload: params,
  });
}

async function reprocessNotification({ tenantId, notificationId, force = true } = {}) {
  const delivery = await getDeliveryById({ tenantId, notificationId });
  if (!delivery) return { ok: false, error: 'notification_not_found' };

  const reset = await updateDelivery(delivery, {
    status: DELIVERY_STATUS.PENDING,
    last_error: null,
  });

  await enqueueJob({
    tenantId,
    kind: DISPATCH_JOB_KIND,
    payload: {
      tenantId,
      notificationId,
      force: !!force,
    },
    runAt: new Date(),
    priority: 2,
    maxAttempts: Number(reset.max_attempts || DEFAULT_MAX_ATTEMPTS),
    idempotencyKey: `notif_reprocess:${notificationId}:${Date.now()}`,
  });

  return { ok: true, item: reset };
}

async function listNotificationDeliveries({
  tenantId,
  vertical = null,
  status = null,
  channel = null,
  subjectId = null,
  customerId = null,
  membershipId = null,
  transactionId = null,
  scheduleId = null,
  limit = 100,
  offset = 0,
} = {}) {
  if (!dbAvailable()) return { items: [], total: 0, limit, offset };
  const Model = deliveryModel();
  if (!Model) return { items: [], total: 0, limit, offset };

  const where = { tenant_key: tenantId };
  if (vertical) where.vertical = vertical;
  if (status) where.status = status;
  if (channel) where.channel = normalizeChannel(channel);
  if (subjectId) where.subject_id = subjectId;
  if (customerId) where.customer_id = customerId;
  if (membershipId) where.membership_id = membershipId;
  if (transactionId) where.transaction_id = transactionId;
  if (scheduleId) where.schedule_id = scheduleId;

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  }).catch(() => ({ count: 0, rows: [] }));

  return {
    total: Number(count || 0),
    items: (rows || []).map(coerceDelivery),
    limit: safeLimit,
    offset: safeOffset,
  };
}

module.exports = {
  DEFAULT_TEMPLATES,
  DELIVERY_STATUS,
  DISPATCH_JOB_KIND,
  buildCanonicalDeliveryInput,
  queueNotification,
  enqueueNotification,
  dispatchNotification,
  sendJourneyNotification,
  reprocessNotification,
  listNotificationDeliveries,
  getDeliveryById,
  maskRecipient,
  resolveTemplate,
};

'use strict';

/**
 * Market Journey Service (varejo/ecommerce)
 *
 * Jornada do cliente de varejo sobre o domínio de pedidos existente
 * (api/services/orderService.js) + customerJourneyEngine (eventos idempotentes):
 *
 *   compra (purchase_completed)
 *     → avaliação pós-entrega (review_requested)
 *     → lembrete de reposição (restock_reminder_sent) para consumíveis
 *     → campanha de fidelização/win-back (loyalty_campaign_sent) para inativos
 *
 * Regras determinísticas de negócio (computedBy: 'business_rule') — não exigem
 * ML: janelas de reposição e inatividade são política do tenant, não previsão.
 */

const { emitJourneyEvent } = require('./customerJourneyEngine');
const { enqueueNotification } = require('../notificationService');

const VERTICAL = 'market';

async function queueMarketNotification({
  tenantId,
  channel = 'whatsapp',
  subjectId = null,
  customerId = null,
  eventType,
  metadata = {},
}) {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  if (!normalizedChannel || normalizedChannel === 'internal') return;
  await enqueueNotification({
    tenantId,
    vertical: VERTICAL,
    channel: normalizedChannel,
    eventType,
    subjectId,
    customerId,
    recipient: customerId || subjectId || null,
    metadata: { ...metadata, vertical: VERTICAL },
  }).catch(() => {});
}

/**
 * Registra uma compra concluída na jornada do cliente.
 * Idempotente por pedido.
 */
async function recordPurchaseCompleted({ tenantId, subjectId = null, customerId = null, orderId, orderNumber = null, amount = null, items = [], channel = 'internal', correlationId = null, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'purchase_completed',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'order_service',
    correlationId,
    idempotencyKey: orderId ? `market_purchase:${tenantId}:${orderId}` : null,
    payload: { context: 'purchase', orderId, orderNumber, amount, items, computedBy: 'business_rule', ...metadata },
  });
}

/**
 * Solicita avaliação pós-entrega.
 * Idempotente por pedido.
 */
async function requestReview({ tenantId, subjectId = null, customerId = null, orderId, orderNumber = null, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'review_requested',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: orderId ? `market_review:${tenantId}:${orderId}` : null,
    payload: { context: 'post_delivery', orderId, orderNumber, ...metadata },
  });
  await queueMarketNotification({ tenantId, channel, subjectId, customerId, eventType: 'review_requested', metadata: { ...metadata, orderId, orderNumber } });
  return evt;
}

/**
 * Lembrete de reposição: cliente comprou consumível há N dias e está na hora
 * de recomprar (ração, café, cosmético, etc.).
 * Idempotente por chave de campanha (cliente + dia).
 */
async function sendRestockReminder({ tenantId, subjectId = null, customerId = null, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const campaignKey = metadata.campaignKey || correlationId;
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'restock_reminder_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: campaignKey ? `market_restock:${tenantId}:${campaignKey}` : null,
    payload: { reason: 'restock_due', computedBy: 'business_rule', ...metadata },
  });
  await queueMarketNotification({ tenantId, channel, subjectId, customerId, eventType: 'restock_reminder_sent', metadata: { ...metadata, reason: 'restock_due' } });
  return evt;
}

/**
 * Campanha de fidelização/win-back para cliente inativo (sem compra na janela).
 * Idempotente por chave de campanha.
 */
async function sendLoyaltyCampaign({ tenantId, subjectId = null, customerId = null, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const campaignKey = metadata.campaignKey || correlationId;
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'loyalty_campaign_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: campaignKey ? `market_loyalty:${tenantId}:${campaignKey}` : null,
    payload: { reason: metadata.reason || 'win_back', computedBy: 'business_rule', ...metadata },
  });
  await queueMarketNotification({ tenantId, channel, subjectId, customerId, eventType: 'loyalty_campaign_sent', metadata: { ...metadata, reason: metadata.reason || 'win_back' } });
  return evt;
}

module.exports = {
  VERTICAL,
  recordPurchaseCompleted,
  requestReview,
  sendRestockReminder,
  sendLoyaltyCampaign,
};

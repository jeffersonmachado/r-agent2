const crypto = require('crypto');
const { Delivery } = require('../db/models');
const { appendEventV1 } = require('./eventLedgerService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function makeId() {
  return `del-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

async function createDeliveryForOrder({
  tenantId,
  orderId,
  deliveryAddress = {},
  estimatedDeliveryAt = null,
  context = {},
}) {
  const Model = Delivery();
  const sequelize = Model.sequelize;
  const idk = context && context.idempotencyKey ? safeToString(context.idempotencyKey) : null;
  if (idk && sequelize) {
    try {
      const [rows] = await sequelize.query(
        `SELECT id
         FROM deliveries
         WHERE tenant_key = :tenantKey
           AND (context->>'idempotencyKey') = :idk
           AND created_at::date = CURRENT_DATE
         ORDER BY created_at DESC
         LIMIT 1`,
        { replacements: { tenantKey: tenantId, idk } },
      );
      if (Array.isArray(rows) && rows[0] && rows[0].id) {
        const existing = await Model.findOne({ where: { tenant_key: tenantId, id: safeToString(rows[0].id) } });
        if (existing) return existing.toJSON ? existing.toJSON() : existing;
      }
    } catch (_) {}
  }
  const id = makeId();
  const row = await Model.create({
    id,
    tenant_key: tenantId,
    order_id: orderId,
    status: 'pending',
    delivery_address: deliveryAddress || {},
    estimated_delivery_at: estimatedDeliveryAt,
    context: context || {},
  });
  const json = row.toJSON ? row.toJSON() : row;

  // best-effort: emit canonical event
  try {
    const correlationId = context && context.correlationId ? safeToString(context.correlationId) : (context?.orderCorrelationId ? safeToString(context.orderCorrelationId) : null);
    await appendEventV1({
      tenantId,
      type: 'DeliveryCreated',
      source: 'delivery.api',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'delivery', id },
      actor: context && context.publicTokenId ? { type: 'public_token', id: safeToString(context.publicTokenId) } : { type: 'system', id: 'api' },
      idempotencyKey: context && context.idempotencyKey ? `delivery_created:${tenantId}:${safeToString(context.idempotencyKey)}` : null,
      payload: { deliveryId: id, orderId, status: 'pending' },
    });
  } catch (_) {}

  return json;
}

async function getDeliveryByOrderId({ tenantId, orderId }) {
  const Model = Delivery();
  const row = await Model.findOne({ where: { tenant_key: tenantId, order_id: orderId } });
  if (!row) return null;
  return row.toJSON ? row.toJSON() : row;
}

async function updateDeliveryStatus({ tenantId, deliveryId, status, patch = {} }) {
  const Model = Delivery();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: deliveryId } });
  if (!row) {
    const err = new Error('delivery_not_found');
    // @ts-ignore
    err.code = 'delivery_not_found';
    throw err;
  }
  const next = safeToString(status);
  const now = new Date();
  const timestamps = {};
  if (next === 'dispatched') timestamps.dispatched_at = now;
  if (next === 'delivered') timestamps.delivered_at = now;
  if (next === 'cancelled') timestamps.cancelled_at = now;
  await row.update({
    status: next,
    ...timestamps,
    ...patch,
  });
  const json = row.toJSON ? row.toJSON() : row;

  // best-effort: emit canonical event
  try {
    const correlationId = json?.context?.correlationId || null;
    await appendEventV1({
      tenantId,
      type: 'DeliveryStatusChanged',
      source: 'delivery.api',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'delivery', id: deliveryId },
      actor: { type: 'system', id: 'api' },
      idempotencyKey: `delivery_status:${tenantId}:${deliveryId}:${next}:${safeToString(json.updated_at || '')}`,
      payload: {
        deliveryId,
        orderId: json?.order_id || null,
        toStatus: next,
      },
    });
  } catch (_) {}

  return json;
}

module.exports = {
  createDeliveryForOrder,
  getDeliveryByOrderId,
  updateDeliveryStatus,
};

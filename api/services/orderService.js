const crypto = require('crypto');
const { Order } = require('../db/models');
const { appendEventV1 } = require('./eventLedgerService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  return safeToString(value, fallback).trim();
}

function makeId() {
  return `ord-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function makeCorrelationId(prefix = 'cor') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function makeOrderNumber({ tenantId }) {
  // Simples e único por tenant, suficiente para v1.
  const shortTenant = safeToString(tenantId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 't';
  return `${shortTenant}-${Date.now().toString(36)}`;
}

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => ({
      name: it && it.name != null ? safeTrim(it.name) : '',
      qty: it && it.qty != null ? Number(it.qty) : 1,
      notes: it && it.notes != null ? safeTrim(it.notes) : null,
      price: it && it.price != null ? Number(it.price) : null,
    }))
    .filter((it) => it.name);
}

function normalizeMarketingAttribution(value) {
  if (!value || typeof value !== 'object') return null;

  const normalized = {
    utm_source: value.utm_source != null ? safeTrim(value.utm_source) || null : null,
    utm_campaign: value.utm_campaign != null ? safeTrim(value.utm_campaign) || null : null,
    utm_medium: value.utm_medium != null ? safeTrim(value.utm_medium) || null : null,
    utm_content: value.utm_content != null ? safeTrim(value.utm_content) || null : null,
    utm_term: value.utm_term != null ? safeTrim(value.utm_term) || null : null,
    gclid: value.gclid != null ? safeTrim(value.gclid) || null : null,
    gbraid: value.gbraid != null ? safeTrim(value.gbraid) || null : null,
    wbraid: value.wbraid != null ? safeTrim(value.wbraid) || null : null,
    campaignId: value.campaignId != null ? safeTrim(value.campaignId) || null : null,
    campaignName: value.campaignName != null ? safeTrim(value.campaignName) || null : null,
    adGroupId: value.adGroupId != null ? safeTrim(value.adGroupId) || null : null,
    adGroupName: value.adGroupName != null ? safeTrim(value.adGroupName) || null : null,
    keywordText: value.keywordText != null ? safeTrim(value.keywordText) || null : null,
    searchTerm: value.searchTerm != null ? safeTrim(value.searchTerm) || null : null,
  };

  return Object.values(normalized).some((item) => item) ? normalized : null;
}

function normalizeOrderContext(context) {
  const source = context && typeof context === 'object' ? context : {};
  const normalized = { ...source };

  normalized.correlationId = source.correlationId ? safeTrim(source.correlationId) || null : null;
  normalized.idempotencyKey = source.idempotencyKey ? safeTrim(source.idempotencyKey) || null : null;
  normalized.publicTokenId = source.publicTokenId ? safeTrim(source.publicTokenId) || null : null;

  if (Object.prototype.hasOwnProperty.call(source, 'marketingAttribution')) {
    normalized.marketingAttribution = normalizeMarketingAttribution(source.marketingAttribution);
  }

  if (!normalized.correlationId) delete normalized.correlationId;
  if (!normalized.idempotencyKey) delete normalized.idempotencyKey;
  if (!normalized.publicTokenId) delete normalized.publicTokenId;
  if (!normalized.marketingAttribution) delete normalized.marketingAttribution;

  return normalized;
}

function hasMarketingAttribution(value) {
  return !!(value && typeof value === 'object' && Object.values(value).some((item) => !!item));
}

async function createOrder({
  tenantId,
  source = 'storefront',
  locationId = null,
  customerName = null,
  customerPhone = null,
  items = [],
  totalAmount = null,
  notes = null,
  deliveryType = 'delivery',
  deliveryAddress = {},
  context = {},
}) {
  const Model = Order();
  const sequelize = Model.sequelize;
  const id = makeId();
  const orderNumber = makeOrderNumber({ tenantId });
  const normalizedContext = normalizeOrderContext(context);
  const correlationId = normalizedContext.correlationId || makeCorrelationId('ordcor');

  const cleanItems = normalizeItems(items);
  if (cleanItems.length === 0) {
    const err = new Error('order_items_required');
    // @ts-ignore
    err.code = 'order_items_required';
    throw err;
  }

  // Idempotência (v1): se o caller fornecer context.idempotencyKey, evita duplicar pedidos
  // em retries HTTP (ex.: storefront) no mesmo dia.
  try {
    const idk = normalizedContext.idempotencyKey || null;
    if (idk && sequelize) {
      const [rows] = await sequelize.query(
        `SELECT id
         FROM orders
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
    }
  } catch (_) {}

  const row = await Model.create({
    id,
    tenant_key: tenantId,
    order_number: orderNumber,
    status: 'created',
    source,
    location_id: locationId,
    customer_name: customerName,
    customer_phone: customerPhone,
    items: cleanItems,
    total_amount: totalAmount,
    notes,
    delivery_type: deliveryType,
    delivery_address: deliveryAddress || {},
    context: { ...normalizedContext, correlationId },
  });

  const json = row.toJSON ? row.toJSON() : row;
  const marketingAttributionPresent = hasMarketingAttribution(json?.context?.marketingAttribution);

  // best-effort: emit canonical event
  try {
    await appendEventV1({
      tenantId,
      type: 'OrderCreated',
      source: source ? `orders.${source}` : 'orders',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'order', id },
      actor: normalizedContext.publicTokenId ? { type: 'public_token', id: normalizedContext.publicTokenId } : { type: 'system', id: 'api' },
      idempotencyKey: normalizedContext.idempotencyKey ? `order_created:${tenantId}:${normalizedContext.idempotencyKey}` : null,
      payload: {
        orderId: id,
        orderNumber,
        status: 'created',
        deliveryType,
        locationId: locationId || null,
        hasMarketingAttribution: marketingAttributionPresent,
      },
    });

    if (!marketingAttributionPresent) {
      await appendEventV1({
        tenantId,
        type: 'OrderMarketingAttributionMissing',
        source: source ? `orders.${source}` : 'orders',
        occurredAt: new Date(),
        correlationId,
        subject: { type: 'order', id },
        actor: normalizedContext.publicTokenId ? { type: 'public_token', id: normalizedContext.publicTokenId } : { type: 'system', id: 'api' },
        idempotencyKey: `order_missing_marketing_attribution:${tenantId}:${id}`,
        payload: {
          orderId: id,
          orderNumber,
          status: 'created',
          deliveryType,
          locationId: locationId || null,
          source: source || 'orders',
        },
      });
    }
  } catch (_) {}

  return json;
}

function isValidTransition(fromStatus, toStatus) {
  const allowed = {
    created: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['dispatched', 'cancelled'],
    dispatched: ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  };
  const nexts = allowed[fromStatus] || [];
  return nexts.includes(toStatus);
}

function patchTimestampsForStatus(status) {
  const now = new Date();
  switch (status) {
    case 'confirmed': return { confirmed_at: now };
    case 'preparing': return { preparing_at: now };
    case 'ready': return { ready_at: now };
    case 'dispatched': return { dispatched_at: now };
    case 'delivered': return { delivered_at: now };
    case 'cancelled': return { cancelled_at: now };
    default: return {};
  }
}

async function updateOrderStatus({ tenantId, orderId, status }) {
  const Model = Order();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: orderId } });
  if (!row) {
    const err = new Error('order_not_found');
    // @ts-ignore
    err.code = 'order_not_found';
    throw err;
  }

  const next = safeToString(status);
  if (!isValidTransition(row.status, next)) {
    const err = new Error('invalid_order_status_transition');
    // @ts-ignore
    err.code = 'invalid_order_status_transition';
    // @ts-ignore
    err.details = { from: row.status, to: next };
    throw err;
  }

  await row.update({
    status: next,
    ...patchTimestampsForStatus(next),
  });

  const json = row.toJSON ? row.toJSON() : row;
  const correlationId = json?.context?.correlationId || null;

  // best-effort: emit canonical event
  try {
    await appendEventV1({
      tenantId,
      type: 'OrderStatusChanged',
      source: 'orders.api',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'order', id: orderId },
      actor: { type: 'system', id: 'api' },
      idempotencyKey: `order_status:${tenantId}:${orderId}:${next}:${safeToString(json.updated_at || '')}`,
      payload: {
        orderId: orderId,
        fromStatus: row.previous('status') || null,
        toStatus: next,
      },
    });
  } catch (_) {}

  return json;
}

async function listOrders({ tenantId, status = null, limit = 50, offset = 0 }) {
  const Model = Order();
  const where = { tenant_key: tenantId };
  if (status) where.status = safeToString(status);
  const { rows, count } = await Model.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset: Number(offset),
  });
  return {
    items: rows.map((r) => (r.toJSON ? r.toJSON() : r)),
    total: count,
  };
}

async function getOrderById({ tenantId, orderId }) {
  const Model = Order();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: orderId } });
  if (!row) return null;
  return row.toJSON ? row.toJSON() : row;
}

async function getOrderIncident({ tenantId, orderId }) {
  const order = await getOrderById({ tenantId, orderId });
  if (!order) return null;
  const ctx = order.context && typeof order.context === 'object' ? order.context : {};
  return ctx.incident && typeof ctx.incident === 'object' ? ctx.incident : null;
}

async function setOrderIncident({ tenantId, orderId, incident }) {
  const Model = Order();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: orderId } });
  if (!row) {
    const err = new Error('order_not_found');
    // @ts-ignore
    err.code = 'order_not_found';
    throw err;
  }
  const ctx = (row.context && typeof row.context === 'object') ? { ...row.context } : {};
  ctx.incident = incident && typeof incident === 'object' ? incident : null;
  await row.update({ context: ctx });
  return row.toJSON ? row.toJSON() : row;
}

async function getOrderMetrics({ tenantId, locationId = null }) {
  const Model = Order();
  const sequelize = Model.sequelize;
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const replacements = { tenantKey: tenantId };
  const slaReadyMin = intEnv('SLA_ORDER_TO_READY_MIN', 25);
  const slaDeliverMin = intEnv('SLA_ORDER_TO_DELIVER_MIN', 60);
  replacements.slaReadySec = slaReadyMin * 60;
  replacements.slaDeliverSec = slaDeliverMin * 60;
  let locSql = '';
  if (locationId != null) {
    locSql = 'AND location_id = :locationId';
    replacements.locationId = safeToString(locationId);
  }

  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'created')::int AS created_count,
       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_count,
       COUNT(*) FILTER (WHERE status = 'preparing')::int AS preparing_count,
       COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
       COUNT(*) FILTER (WHERE status = 'dispatched')::int AS dispatched_count,
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_count,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
       AVG(EXTRACT(EPOCH FROM (ready_at - confirmed_at))) FILTER (WHERE ready_at IS NOT NULL AND confirmed_at IS NOT NULL)::float AS avg_order_to_ready_seconds,
       AVG(EXTRACT(EPOCH FROM (delivered_at - confirmed_at))) FILTER (WHERE delivered_at IS NOT NULL AND confirmed_at IS NOT NULL)::float AS avg_order_to_deliver_seconds,
       COUNT(*) FILTER (
         WHERE ready_at IS NOT NULL
           AND confirmed_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (ready_at - confirmed_at)) > :slaReadySec
       )::int AS sla_ready_breached_count,
       COUNT(*) FILTER (
         WHERE delivered_at IS NOT NULL
           AND confirmed_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (delivered_at - confirmed_at)) > :slaDeliverSec
       )::int AS sla_deliver_breached_count
     FROM orders
     WHERE tenant_key = :tenantKey
       ${locSql}
       AND created_at::date = CURRENT_DATE`,
    { replacements },
  );
  const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const [byHourRows] = await sequelize.query(
    `SELECT
       EXTRACT(HOUR FROM created_at)::int AS hour,
       COUNT(*)::int AS created_count,
       COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_count,
       COUNT(*) FILTER (WHERE status = 'preparing')::int AS preparing_count,
       COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_count,
       COUNT(*) FILTER (WHERE status = 'dispatched')::int AS dispatched_count,
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_count,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count
     FROM orders
     WHERE tenant_key = :tenantKey
       ${locSql}
       AND created_at::date = CURRENT_DATE
     GROUP BY EXTRACT(HOUR FROM created_at)
     ORDER BY hour ASC`,
    { replacements },
  );

  return {
    ok: true,
    tenantId,
    locationId: locationId || null,
    today: {
      createdCount: Number(r.created_count || 0),
      confirmedCount: Number(r.confirmed_count || 0),
      preparingCount: Number(r.preparing_count || 0),
      readyCount: Number(r.ready_count || 0),
      dispatchedCount: Number(r.dispatched_count || 0),
      deliveredCount: Number(r.delivered_count || 0),
      cancelledCount: Number(r.cancelled_count || 0),
      avgOrderToReadySeconds: r.avg_order_to_ready_seconds != null ? Number(r.avg_order_to_ready_seconds) : null,
      avgOrderToDeliverSeconds: r.avg_order_to_deliver_seconds != null ? Number(r.avg_order_to_deliver_seconds) : null,
      slaOrderToReadyBreachedCount: Number(r.sla_ready_breached_count || 0),
      slaOrderToDeliverBreachedCount: Number(r.sla_deliver_breached_count || 0),
      slaOrderToReadyMinutes: slaReadyMin,
      slaOrderToDeliverMinutes: slaDeliverMin,
    },
    byHour: Array.isArray(byHourRows) ? byHourRows : [],
  };
}

module.exports = {
  createOrder,
  updateOrderStatus,
  listOrders,
  getOrderById,
  getOrderIncident,
  setOrderIncident,
  getOrderMetrics,
};

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { appendEventV1 } = require('./eventLedgerService');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function minutesToMs(m) {
  return Math.max(1, m) * 60 * 1000;
}

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

async function scanOrdersSla() {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const maxOrderToReadyMin = intEnv('SLA_ORDER_TO_READY_MIN', 25);
  const maxOrderToDeliverMin = intEnv('SLA_ORDER_TO_DELIVER_MIN', 60);
  const day = todayKey();

  // confirmed/preparing older than threshold without ready
  const [rows] = await sequelize.query(
    `SELECT id, tenant_key, status, confirmed_at, preparing_at, ready_at, dispatched_at, delivered_at, context
     FROM orders
     WHERE status IN ('confirmed','preparing')
       AND (
         (confirmed_at IS NOT NULL AND confirmed_at < NOW() - INTERVAL '${maxOrderToReadyMin} minutes')
         OR (preparing_at IS NOT NULL AND preparing_at < NOW() - INTERVAL '${maxOrderToReadyMin} minutes')
       )
     ORDER BY confirmed_at NULLS LAST, preparing_at NULLS LAST
     LIMIT 200`,
  );

  let emitted = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const correlationId = r?.context?.correlationId || null;
    const idem = `delivery_sla_risk:${r.tenant_key}:${r.id}:${day}:ready`;
    try {
      await appendEventV1({
        tenantId: r.tenant_key,
        type: 'DeliverySLARisk',
        source: 'ops.sla',
        occurredAt: new Date(),
        correlationId,
        subject: { type: 'order', id: r.id },
        actor: { type: 'system', id: 'sla_scanner' },
        idempotencyKey: idem,
        payload: {
          orderId: r.id,
          status: r.status,
          riskType: 'order_to_ready',
          thresholdMin: maxOrderToReadyMin,
        },
      });
      emitted += 1;
    } catch (_) {}
  }

  // dispatched older than threshold without delivered
  const [rows2] = await sequelize.query(
    `SELECT id, tenant_key, status, dispatched_at, delivered_at, context
     FROM orders
     WHERE status = 'dispatched'
       AND dispatched_at IS NOT NULL
       AND dispatched_at < NOW() - INTERVAL '${maxOrderToDeliverMin} minutes'
     ORDER BY dispatched_at ASC
     LIMIT 200`,
  );

  for (const r of Array.isArray(rows2) ? rows2 : []) {
    const correlationId = r?.context?.correlationId || null;
    const idem = `delivery_sla_risk:${r.tenant_key}:${r.id}:${day}:deliver`;
    try {
      await appendEventV1({
        tenantId: r.tenant_key,
        type: 'DeliverySLARisk',
        source: 'ops.sla',
        occurredAt: new Date(),
        correlationId,
        subject: { type: 'order', id: r.id },
        actor: { type: 'system', id: 'sla_scanner' },
        idempotencyKey: idem,
        payload: {
          orderId: r.id,
          status: r.status,
          riskType: 'order_to_deliver',
          thresholdMin: maxOrderToDeliverMin,
        },
      });
      emitted += 1;
    } catch (_) {}
  }

  return { ok: true, emitted };
}

async function scanPhysicalSla() {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const maxWaitMin = intEnv('SLA_PHYSICAL_WAIT_MIN', 15);
  const day = todayKey();

  const [rows] = await sequelize.query(
    `SELECT id, tenant_key, ticket_number, status, priority, created_at, context
     FROM physical_tickets
     WHERE status = 'waiting'
       AND created_at < NOW() - INTERVAL '${maxWaitMin} minutes'
     ORDER BY created_at ASC
     LIMIT 200`,
  );

  let emitted = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const correlationId = r?.context?.correlationId || null;
    const idem = `physical_sla_risk:${r.tenant_key}:${r.id}:${day}`;
    try {
      await appendEventV1({
        tenantId: r.tenant_key,
        type: 'PhysicalSLARisk',
        source: 'ops.sla',
        occurredAt: new Date(),
        correlationId,
        subject: { type: 'physical_ticket', id: r.id },
        actor: { type: 'system', id: 'sla_scanner' },
        idempotencyKey: idem,
        payload: {
          ticketId: r.id,
          ticketNumber: r.ticket_number,
          thresholdMin: maxWaitMin,
          priority: r.priority,
          locationId: r?.context?.locationId || null,
        },
      });
      emitted += 1;
    } catch (_) {}
  }
  return { ok: true, emitted };
}

async function runSlaScan() {
  const started = Date.now();
  const [orders, physical] = await Promise.all([
    scanOrdersSla().catch((err) => ({ ok: false, error: err.message })),
    scanPhysicalSla().catch((err) => ({ ok: false, error: err.message })),
  ]);
  const result = { ok: true, orders, physical, durationMs: Date.now() - started };
  try {
    logger.info('[OpsSLA] scan concluído', result);
  } catch (_) {}
  return result;
}

module.exports = {
  runSlaScan,
  minutesToMs,
};


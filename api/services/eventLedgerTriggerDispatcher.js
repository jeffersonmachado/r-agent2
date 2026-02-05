/**
 * Event ledger -> triggers dispatcher (v1).
 *
 * Implements:
 * - scanner job: scans event_ledger using a cursor and enqueues per-event dispatch jobs
 * - dispatch job: resolves event and triggers webhooks (event_ledger.<type>)
 *
 * Idempotência/retry/DLQ:
 * - scanner enqueues with execution_jobs.idempotency_key = event.id
 * - executionQueueService retries and ends in DLQ (status=dead) automatically
 */

'use strict';
const { Op } = require('sequelize');
const { getSequelize } = require('../db/sequelize');
const { EventLedger } = require('../db/models');
const { enqueueJob } = require('./executionQueueService');
const { triggerWebhooks } = require('./webhookService');
const { dispatchFlowsForEvent } = require('./flowEventTriggerService');

function dbAvailable() {
  return !!getSequelize();
}

async function ensureStateRow({ consumer }) {
  const sequelize = getSequelize();
  if (!sequelize) return null;
  const id = `eds:${String(consumer)}`;
  await sequelize.query(
    `INSERT INTO event_dispatch_state (id, consumer, last_received_at, last_event_id, created_at, updated_at)
     VALUES (:id, :consumer, '1970-01-01'::timestamptz, NULL, NOW(), NOW())
     ON CONFLICT (consumer) DO NOTHING`,
    { replacements: { id, consumer: String(consumer) } },
  );
  const [rows] = await sequelize.query(
    `SELECT id, consumer, last_received_at, last_event_id
     FROM event_dispatch_state
     WHERE consumer = :consumer
     LIMIT 1`,
    { replacements: { consumer: String(consumer) } },
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function scanAndEnqueue({ consumer = 'webhooks_v1', batchSize = 100 } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const state = await ensureStateRow({ consumer });
  if (!state) return { ok: false, reason: 'state_unavailable' };

  const safeBatch = Math.min(Math.max(Number(batchSize) || 100, 1), 1000);

  // Cursor + lock to avoid concurrent scanners
  return sequelize.transaction(async (t) => {
    const [lockedRows] = await sequelize.query(
      `SELECT id, consumer, last_received_at, last_event_id
       FROM event_dispatch_state
       WHERE consumer = :consumer
       FOR UPDATE`,
      { replacements: { consumer: String(consumer) }, transaction: t },
    );
    const locked = Array.isArray(lockedRows) && lockedRows[0] ? lockedRows[0] : null;
    const lastReceivedAt = locked?.last_received_at ? new Date(locked.last_received_at) : new Date('1970-01-01');
    const lastEventId = locked?.last_event_id ? String(locked.last_event_id) : '';

    const EventModel = EventLedger();
    const events = await EventModel.findAll({
      where: {
        [Op.or]: [
          { received_at: { [Op.gt]: lastReceivedAt } },
          // Tie-breaker: mesma timestamp, usa id lexicográfico
          { received_at: { [Op.eq]: lastReceivedAt }, id: { [Op.gt]: lastEventId } },
        ],
      },
      order: [['received_at', 'ASC'], ['id', 'ASC']],
      limit: safeBatch,
      transaction: t,
    }).catch(() => []);

    if (!events || events.length === 0) {
      return { ok: true, enqueued: 0, cursor: { receivedAt: lastReceivedAt.toISOString(), eventId: lastEventId || null } };
    }

    let maxReceivedAt = lastReceivedAt;
    let maxEventId = lastEventId;
    let enqueued = 0;

    for (const ev of events) {
      const json = ev.toJSON ? ev.toJSON() : ev;
      const tenantId = json.tenant_key;
      const eventId = json.id;
      const receivedAt = json.received_at ? new Date(json.received_at) : null;
      if (receivedAt) {
        if (receivedAt > maxReceivedAt) {
          maxReceivedAt = receivedAt;
          maxEventId = String(eventId || '');
        } else if (receivedAt.getTime() === maxReceivedAt.getTime() && String(eventId || '') > String(maxEventId || '')) {
          maxEventId = String(eventId || '');
        }
      }

      // Enqueue per-event dispatch job (idempotent via execution_jobs unique index)
      // eslint-disable-next-line no-await-in-loop
      await enqueueJob({
        tenantId,
        kind: 'dispatch_event_trigger',
        payload: {
          consumer: String(consumer),
          eventId: String(eventId),
        },
        runAt: new Date(),
        priority: 0,
        maxAttempts: 10,
        idempotencyKey: `event_dispatch:${String(eventId)}`,
      }).then(() => { enqueued += 1; }).catch(() => {});
    }

    await sequelize.query(
      `UPDATE event_dispatch_state
       SET last_received_at = :ts, last_event_id = :eid, updated_at = NOW()
       WHERE consumer = :consumer`,
      { replacements: { ts: maxReceivedAt, eid: maxEventId || null, consumer: String(consumer) }, transaction: t },
    );

    return { ok: true, enqueued, cursor: { receivedAt: maxReceivedAt.toISOString(), eventId: maxEventId || null } };
  });
}

async function dispatchOne({ tenantId, consumer = 'webhooks_v1', eventId }) {
  if (!dbAvailable()) return { ok: false, reason: 'db_unavailable' };
  if (!tenantId || !eventId) return { ok: false, reason: 'invalid_args' };

  const EventModel = EventLedger();
  const ev = await EventModel.findOne({ where: { tenant_key: String(tenantId), id: String(eventId) } });
  if (!ev) return { ok: false, reason: 'event_not_found' };

  const json = ev.toJSON ? ev.toJSON() : ev;
  const type = String(json.type || '').trim();

  // Trigger webhooks: event_ledger.<type>
  const eventName = `event_ledger.${type}`;
  await triggerWebhooks(String(tenantId), eventName, {
    id: json.id,
    type: json.type,
    source: json.source,
    occurredAt: json.occurred_at,
    receivedAt: json.received_at,
    correlationId: json.correlation_id,
    subject: { type: json.subject_type || null, id: json.subject_id || null },
    actor: { type: json.actor_type || null, id: json.actor_id || null },
    payload: json.payload || {},
  });

  // Trigger flows (best-effort) via metadata.eventTriggers
  try {
    await dispatchFlowsForEvent({
      tenantId: String(tenantId),
      event: {
        id: json.id,
        type: json.type,
        source: json.source,
        occurredAt: json.occurred_at,
        receivedAt: json.received_at,
        correlationId: json.correlation_id,
        subject: { type: json.subject_type || null, id: json.subject_id || null },
        actor: { type: json.actor_type || null, id: json.actor_id || null },
        payload: json.payload || {},
      },
    });
  } catch (_) {}

  return { ok: true, dispatched: true, eventName };
}

module.exports = {
  scanAndEnqueue,
  dispatchOne,
};


/**
 * Event ledger -> triggers dispatcher (v1).
 *
 * Implements:
 * - scanner job: scans event_ledger using a cursor and enqueues per-event dispatch jobs
 * - dispatch job: resolves event and triggers webhooks (event_ledger.<type>) and/or flows
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

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim(); } catch (_) { return fallback; }
}

async function ensureStateRow({ consumer }) {
  const sequelize = getSequelize();
  if (!sequelize) return null;
  const consumerKey = safeToString(consumer);
  const id = `eds:${consumerKey}`;
  await sequelize.query(
    `INSERT INTO event_dispatch_state (id, consumer, last_received_at, last_event_id, created_at, updated_at)
     VALUES (:id, :consumer, '1970-01-01'::timestamptz, NULL, NOW(), NOW())
     ON CONFLICT (consumer) DO NOTHING`,
    { replacements: { id, consumer: consumerKey } },
  );
  const [rows] = await sequelize.query(
    `SELECT id, consumer, last_received_at, last_event_id
     FROM event_dispatch_state
     WHERE consumer = :consumer
     LIMIT 1`,
    { replacements: { consumer: consumerKey } },
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function boolEnv(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return def;
}

async function scanAndEnqueue({ consumer = 'webhooks_v1', batchSize = 100, dispatchTargets = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };
  const consumerKey = safeToString(consumer, 'webhooks_v1') || 'webhooks_v1';

  const state = await ensureStateRow({ consumer: consumerKey });
  if (!state) return { ok: false, reason: 'state_unavailable' };

  const safeBatch = Math.min(Math.max(Number(batchSize) || 100, 1), 1000);

  // Cursor + lock to avoid concurrent scanners
  return sequelize.transaction(async (t) => {
    const [lockedRows] = await sequelize.query(
      `SELECT id, consumer, last_received_at, last_event_id
       FROM event_dispatch_state
       WHERE consumer = :consumer
       FOR UPDATE`,
      { replacements: { consumer: consumerKey }, transaction: t },
    );
    const locked = Array.isArray(lockedRows) && lockedRows[0] ? lockedRows[0] : null;
    const lastReceivedAt = locked?.last_received_at ? new Date(locked.last_received_at) : new Date('1970-01-01');
    const lastEventId = locked?.last_event_id ? safeToString(locked.last_event_id) : '';

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

    const splitTargets = Array.isArray(dispatchTargets) && dispatchTargets.length
      ? dispatchTargets
      : (boolEnv('EVENT_DISPATCH_SPLIT_TARGETS', false) ? ['webhooks', 'flows'] : null);

    for (const ev of events) {
      const json = ev.toJSON ? ev.toJSON() : ev;
      const tenantId = json.tenant_key;
      const eventId = json.id;
      const receivedAt = json.received_at ? new Date(json.received_at) : null;
      if (receivedAt) {
        if (receivedAt > maxReceivedAt) {
          maxReceivedAt = receivedAt;
          maxEventId = safeToString(eventId || '');
        } else if (receivedAt.getTime() === maxReceivedAt.getTime() && safeToString(eventId || '') > safeToString(maxEventId || '')) {
          maxEventId = safeToString(eventId || '');
        }
      }

      if (splitTargets && splitTargets.length) {
        for (const target of splitTargets) {
          // eslint-disable-next-line no-await-in-loop
          await enqueueJob({
            tenantId,
            kind: 'dispatch_event_trigger',
            payload: {
              consumer: consumerKey,
              eventId: safeToString(eventId),
              dispatchTargets: [safeToString(target)],
            },
            runAt: new Date(),
            priority: 0,
            maxAttempts: 10,
            idempotencyKey: `event_dispatch:${safeToString(eventId)}:${safeToString(target)}`,
          }).then(() => { enqueued += 1; }).catch(() => {});
        }
      } else {
        // Enqueue per-event dispatch job (idempotent via execution_jobs unique index)
        // eslint-disable-next-line no-await-in-loop
        await enqueueJob({
          tenantId,
          kind: 'dispatch_event_trigger',
          payload: {
            consumer: consumerKey,
            eventId: safeToString(eventId),
          },
          runAt: new Date(),
          priority: 0,
          maxAttempts: 10,
          idempotencyKey: `event_dispatch:${safeToString(eventId)}`,
        }).then(() => { enqueued += 1; }).catch(() => {});
      }
    }

    await sequelize.query(
      `UPDATE event_dispatch_state
       SET last_received_at = :ts, last_event_id = :eid, updated_at = NOW()
       WHERE consumer = :consumer`,
      { replacements: { ts: maxReceivedAt, eid: maxEventId || null, consumer: consumerKey }, transaction: t },
    );

    return { ok: true, enqueued, cursor: { receivedAt: maxReceivedAt.toISOString(), eventId: maxEventId || null } };
  });
}

async function dispatchOne({ tenantId, consumer = 'webhooks_v1', eventId, dispatchTargets = null }) {
  if (!dbAvailable()) return { ok: false, reason: 'db_unavailable' };
  if (!tenantId || !eventId) return { ok: false, reason: 'invalid_args' };

  const EventModel = EventLedger();
  const tenantKey = safeToString(tenantId);
  const eventKey = safeToString(eventId);
  const ev = await EventModel.findOne({ where: { tenant_key: tenantKey, id: eventKey } });
  if (!ev) return { ok: false, reason: 'event_not_found' };

  const json = ev.toJSON ? ev.toJSON() : ev;
  const type = safeTrim(json.type || '');

  const hasExplicitTargets = Array.isArray(dispatchTargets) && dispatchTargets.length;
  const targets = hasExplicitTargets
    ? dispatchTargets.map((t) => safeToString(t))
    : ['webhooks', 'flows'];
  const strictFailures = boolEnv('EVENT_DISPATCH_STRICT_FAILURES', true);

  const eventPayload = {
    id: json.id,
    type: json.type,
    source: json.source,
    occurredAt: json.occurred_at,
    receivedAt: json.received_at,
    correlationId: json.correlation_id,
    subject: { type: json.subject_type || null, id: json.subject_id || null },
    actor: { type: json.actor_type || null, id: json.actor_id || null },
    payload: json.payload || {},
  };

  let webhooksOk = null;
  let flowsOk = null;
  let webhookError = null;

  if (targets.includes('webhooks')) {
    const eventName = `event_ledger.${type}`;
    try {
      await triggerWebhooks(tenantKey, eventName, eventPayload);
      webhooksOk = true;
    } catch (err) {
      webhooksOk = false;
      webhookError = err;
      if (!hasExplicitTargets) {
        // Legacy behavior: if webhooks fail, abort job (flows won't run).
        throw err;
      }
    }
  }

  if (targets.includes('flows')) {
    try {
      await dispatchFlowsForEvent({ tenantId: tenantKey, event: eventPayload });
      flowsOk = true;
    } catch (err) {
      flowsOk = false;
      if (strictFailures) throw err;
    }
  }

  const onlyWebhooks = targets.length === 1 && targets[0] === 'webhooks';
  if (onlyWebhooks && webhooksOk === false && webhookError) {
    throw webhookError;
  }
  if (strictFailures && webhooksOk === false && webhookError) {
    throw webhookError;
  }

  return {
    ok: true,
    dispatched: true,
    targets,
    webhooksOk,
    flowsOk,
  };
}

module.exports = {
  scanAndEnqueue,
  dispatchOne,
};

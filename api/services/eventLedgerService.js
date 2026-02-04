const { EventLedger } = require('../db/models');
const { buildEventV1 } = require('../events/eventModelV1');

/**
 * Append a canonical event to event_ledger.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.type
 * @param {string} [args.source]
 * @param {Date|string} [args.occurredAt]
 * @param {string|null} [args.correlationId]
 * @param {{type?:string,id?:string}|null} [args.subject]
 * @param {{type?:string,id?:string}|null} [args.actor]
 * @param {string|null} [args.idempotencyKey]
 * @param {object} [args.payload]
 */
async function appendEventV1(args) {
  const evt = buildEventV1(args);
  const Model = EventLedger();

  const occurredAt = new Date(evt.occurred_at);
  const now = new Date();

  // Best-effort: if idempotency_key is present, rely on unique index to dedupe.
  try {
    const row = await Model.create({
      id: evt.id,
      tenant_key: evt.tenant_key,
      type: evt.type,
      source: evt.source,
      occurred_at: occurredAt,
      received_at: now,
      correlation_id: evt.correlation_id,
      subject_type: evt.subject.type,
      subject_id: evt.subject.id,
      actor_type: evt.actor.type,
      actor_id: evt.actor.id,
      idempotency_key: evt.idempotency_key,
      payload: evt.payload || {},
    });
    return row.toJSON ? row.toJSON() : row;
  } catch (err) {
    // Unique violation on (tenant_key, type, idempotency_key) → return existing
    const isUnique = String(err?.name || '').toLowerCase().includes('unique')
      || String(err?.message || '').toLowerCase().includes('unique')
      || String(err?.original?.code || '').toLowerCase() === '23505';
    if (evt.idempotency_key && isUnique) {
      const existing = await Model.findOne({
        where: {
          tenant_key: evt.tenant_key,
          type: evt.type,
          idempotency_key: evt.idempotency_key,
        },
        order: [['received_at', 'DESC']],
      });
      return existing ? (existing.toJSON ? existing.toJSON() : existing) : null;
    }
    throw err;
  }
}

module.exports = {
  appendEventV1,
  /**
   * Query canonical events (read-only).
   *
   * @param {object} args
   * @param {string} args.tenantId
   * @param {string|null} [args.subjectType]
   * @param {string|null} [args.subjectId]
   * @param {string|null} [args.correlationId]
   * @param {string|null} [args.type]
   * @param {number} [args.limit]
   * @param {number} [args.offset]
   */
  async listEvents({ tenantId, subjectType = null, subjectId = null, correlationId = null, type = null, limit = 200, offset = 0 }) {
    const Model = EventLedger();
    const where = { tenant_key: String(tenantId) };
    if (subjectType) where.subject_type = String(subjectType);
    if (subjectId) where.subject_id = String(subjectId);
    if (correlationId) where.correlation_id = String(correlationId);
    if (type) where.type = String(type);

    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 2000);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const { count, rows } = await Model.findAndCountAll({
      where,
      order: [['occurred_at', 'DESC'], ['received_at', 'DESC']],
      limit: safeLimit,
      offset: safeOffset,
    });

    return {
      ok: true,
      total: count,
      items: (rows || []).map((r) => (r.toJSON ? r.toJSON() : r)),
      limit: safeLimit,
      offset: safeOffset,
    };
  },
};


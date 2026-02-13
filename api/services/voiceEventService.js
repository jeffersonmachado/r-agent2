/**
 * Voice events ingestion (v1).
 *
 * Conecta eventos de voz (ARI/AMI/gateway) ao event_ledger para
 * permitir triggers no DAG.
 */
'use strict';

const { appendEventV1 } = require('./eventLedgerService');
const { getSequelize } = require('../db/sequelize');
const { EventLedger } = require('../db/models');

const EVENT_MAP = {
  ringing: 'VoiceCallRinging',
  answered: 'VoiceCallAnswered',
  ended: 'VoiceCallEnded',
  hangup: 'VoiceCallEnded',
  dtmf: 'VoiceCallDtmf',
  transfer: 'VoiceCallTransfer',
};

function normalizeEventType(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return EVENT_MAP[key] || null;
}

function floatEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : def;
}

async function ingestVoiceEvent({
  tenantId,
  eventType,
  callId,
  occurredAt = null,
  correlationId = null,
  subjectType = 'pbx_call',
  subjectId = null,
  actorType = 'system',
  actorId = 'voice_gateway',
  payload = {},
}) {
  if (!tenantId) return { ok: false, error: 'tenant_required' };
  const type = normalizeEventType(eventType);
  if (!type) return { ok: false, error: 'invalid_event_type' };

  const safeCallId = callId ? String(callId) : null;
  const subject = { type: subjectType || 'pbx_call', id: subjectId || safeCallId || null };
  const corr = correlationId || safeCallId || null;
  const idem = safeCallId ? `voice_event:${tenantId}:${type}:${safeCallId}:${String(occurredAt || '')}` : null;

  const row = await appendEventV1({
    tenantId,
    type,
    source: 'voice.gateway',
    occurredAt: occurredAt || new Date(),
    correlationId: corr,
    subject,
    actor: { type: actorType || 'system', id: actorId || 'voice_gateway' },
    idempotencyKey: idem,
    payload: payload && typeof payload === 'object' ? payload : {},
  });

  return { ok: true, event: row };
}

async function getVoiceMetrics({ tenantId, windowDays = 7 } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  if (!tenantId) return { ok: false, error: 'tenant_required' };

  const days = Number.isFinite(Number(windowDays)) ? Math.max(1, Math.floor(Number(windowDays))) : 7;
  const Model = EventLedger();
  const Op = sequelize.constructor.Op;
  const since = new Date(Date.now() - (Number(days) * 24 * 60 * 60 * 1000));
  const costPerMinute = floatEnv('VOICE_COST_PER_MINUTE', 0);
  const rows = await Model.findAll({
    attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    where: {
      tenant_key: String(tenantId),
      type: {
        [Op.or]: [
          { [Op.like]: 'VoiceCall%' },
          { [Op.like]: 'Call%' },
        ],
      },
      received_at: {
        [Op.gte]: since,
      },
    },
    group: ['type'],
    order: [['type', 'ASC']],
  }).catch(() => []);

  const byType = {};
  for (const r of rows || []) {
    const json = r.toJSON ? r.toJSON() : r;
    byType[String(json.type || 'unknown')] = Number(json.total || 0);
  }

  let totalCalls = 0;
  let totalBillSeconds = 0;
  try {
    const [durationRows] = await sequelize.query(
      `SELECT
         COUNT(DISTINCT subject_id)::int AS total_calls,
         COALESCE(SUM(COALESCE((payload->>'billsec')::float, (payload->>'duration')::float, 0)), 0)::float AS total_billsec
       FROM event_ledger
       WHERE tenant_key = :tenantKey
         AND type IN ('CallEnded', 'VoiceCallEnded')
         AND received_at >= :since`,
      { replacements: { tenantKey: String(tenantId), since } },
    );
    const row = Array.isArray(durationRows) && durationRows[0] ? durationRows[0] : {};
    totalCalls = Number(row.total_calls || 0);
    totalBillSeconds = Number(row.total_billsec || 0);
  } catch (_) {}

  const totalMinutes = totalBillSeconds > 0 ? Number((totalBillSeconds / 60).toFixed(2)) : 0;
  const estimatedCost = costPerMinute > 0 ? Number((totalMinutes * costPerMinute).toFixed(2)) : 0;

  return {
    ok: true,
    windowDays: days,
    byType,
    totals: {
      totalCalls,
      totalBillSeconds,
      totalMinutes,
      costPerMinute,
      estimatedCost,
      costPerCall: totalCalls > 0 ? Number((estimatedCost / totalCalls).toFixed(2)) : null,
    },
  };
}

module.exports = { ingestVoiceEvent, getVoiceMetrics };

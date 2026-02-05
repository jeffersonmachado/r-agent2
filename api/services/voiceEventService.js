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
  const rows = await Model.findAll({
    attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    where: {
      tenant_key: String(tenantId),
      type: {
        [Op.like]: 'VoiceCall%',
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

  return {
    ok: true,
    windowDays: days,
    byType,
  };
}

module.exports = { ingestVoiceEvent, getVoiceMetrics };

'use strict';

const logger = require('../../utils/logger');
const { Op } = require('sequelize');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');

function dbAvailable() {
  return !!getSequelize();
}

function toDateOrFallback(v, fallback) {
  if (!v) return fallback;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function intOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function parseRelatedEntities(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ticketId: null, orderId: null };
  const ticketMatch = text.match(/ticket[:=]([a-zA-Z0-9._-]+)/i);
  const orderMatch = text.match(/order[:=]([a-zA-Z0-9._-]+)/i);
  return {
    ticketId: ticketMatch ? String(ticketMatch[1]) : null,
    orderId: orderMatch ? String(orderMatch[1]) : null,
  };
}

async function ensureStateRow({ consumer }) {
  const sequelize = getSequelize();
  if (!sequelize) return null;
  const id = `pces:${String(consumer)}`;

  // Safe cold-start: cursor NUNCA nasce em 1970 (evita re-scan retroativo de
  // TODO o pbx_cdr histórico e flood de eventos CallRinging/Answered/Ended).
  const [maxRows] = await sequelize.query(
    `SELECT COALESCE(MAX(calldate), NOW()) AS max_calldate FROM pbx_cdr`,
  ).catch(() => [[{ max_calldate: null }]]);
  const safeStart = (Array.isArray(maxRows) && maxRows[0] && maxRows[0].max_calldate)
    ? new Date(maxRows[0].max_calldate)
    : new Date();

  await sequelize.query(
    `INSERT INTO pbx_call_event_state (id, consumer, last_calldate, last_cdr_id, created_at, updated_at)
     VALUES (:id, :consumer, :safeStart::timestamptz, NULL, NOW(), NOW())
     ON CONFLICT (consumer) DO UPDATE
       SET last_calldate = EXCLUDED.last_calldate,
           updated_at = NOW()
       WHERE pbx_call_event_state.last_calldate < '2000-01-01'::timestamptz`,
    { replacements: { id, consumer: String(consumer), safeStart } },
  );
  const [rows] = await sequelize.query(
    `SELECT id, consumer, last_calldate, last_cdr_id
     FROM pbx_call_event_state
     WHERE consumer = :consumer
     LIMIT 1`,
    { replacements: { consumer: String(consumer) } },
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Emite call events v0 a partir do pbx_cdr (scanner).
 *
 * Eventos emitidos:
 * - CallRinging (calldate)
 * - CallAnswered (se billsec > 0; answerAt = end - billsec)
 * - CallEnded (endAt = calldate + duration)
 */
async function scanPbxCdrAndEmitEvents({ consumer = 'pbx_cdr_v0', batchSize = 200 } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const state = await ensureStateRow({ consumer });
  if (!state) return { ok: false, reason: 'state_unavailable' };

  const safeBatch = Math.min(Math.max(Number(batchSize) || 200, 1), 2000);

  const PbxCdr = models.PbxCdr();
  const endedCalls = [];

  const scanResult = await sequelize.transaction(async (t) => {
    const [lockedRows] = await sequelize.query(
      `SELECT id, consumer, last_calldate, last_cdr_id
       FROM pbx_call_event_state
       WHERE consumer = :consumer
       FOR UPDATE`,
      { replacements: { consumer: String(consumer) }, transaction: t },
    );
    const locked = Array.isArray(lockedRows) && lockedRows[0] ? lockedRows[0] : null;
    const lastCalldate = locked?.last_calldate ? new Date(locked.last_calldate) : new Date();
    const lastCdrId = locked?.last_cdr_id ? String(locked.last_cdr_id) : '';

    const rows = await PbxCdr.findAll({
      where: {
        [Op.or]: [
          { calldate: { [Op.gt]: lastCalldate } },
          { calldate: { [Op.eq]: lastCalldate }, id: { [Op.gt]: lastCdrId } },
        ],
      },
      order: [['calldate', 'ASC'], ['id', 'ASC']],
      limit: safeBatch,
      transaction: t,
    }).catch(() => []);

    if (!rows || rows.length === 0) {
      return { ok: true, scanned: 0, emitted: 0, cursor: { calldate: lastCalldate.toISOString(), cdrId: lastCdrId || null } };
    }

    let maxCalldate = lastCalldate;
    let maxCdrId = lastCdrId;
    let emitted = 0;

    for (const r of rows) {
      const json = r.toJSON ? r.toJSON() : r;
      const tenantId = json.tenantKey || json.tenant_key || 'unknown';

      const calldate = toDateOrFallback(json.calldate, null);
      if (!calldate) continue;

      // Cursor update
      const cdrId = String(json.id || '');
      if (calldate > maxCalldate) {
        maxCalldate = calldate;
        maxCdrId = cdrId;
      } else if (calldate.getTime() === maxCalldate.getTime() && cdrId > String(maxCdrId || '')) {
        maxCdrId = cdrId;
      }

      const durationSec = intOrZero(json.duration);
      const billsec = intOrZero(json.billsec);
      const endedAt = new Date(calldate.getTime() + durationSec * 1000);
      const answeredAt = billsec > 0 ? new Date(Math.max(calldate.getTime(), endedAt.getTime() - billsec * 1000)) : null;

      const correlationId = String(json.linkedid || json.uniqueid || json.id || '');
      const callIdSource = json.linkedid ? 'linkedid' : (json.uniqueid ? 'uniqueid' : 'cdr_id');
      const subjectId = correlationId || cdrId;

      const basePayload = {
        cdrId: json.id,
        uniqueid: json.uniqueid || null,
        linkedid: json.linkedid || null,
        callId: correlationId || null,
        callIdSource,
        tenantId,
        src: json.src || null,
        dst: json.dst || null,
        clid: json.clid || null,
        disposition: json.disposition || null,
        duration: durationSec,
        billsec,
        channel: json.channel || null,
        dstchannel: json.dstchannel || null,
        dcontext: json.dcontext || null,
        lastapp: json.lastapp || null,
        lastdata: json.lastdata || null,
        accountcode: json.accountcode || null,
      };
      const related = parseRelatedEntities(json.accountcode || json.userfield || '');

      // 1) Ringing (calldate)
      await appendEventV1({
        tenantId,
        type: 'CallRinging',
        source: 'pbx.cdr',
        occurredAt: calldate,
        correlationId,
        subject: { type: 'pbx_call', id: subjectId },
        actor: { type: 'system', id: 'pbx_cdr_scanner' },
        idempotencyKey: `pbx_call_event:${tenantId}:${cdrId}:ringing`,
        payload: { ...basePayload, related },
      }).then(() => { emitted += 1; }).catch(() => {});

      // 2) Answered (se houver billsec)
      if (answeredAt) {
        await appendEventV1({
          tenantId,
          type: 'CallAnswered',
          source: 'pbx.cdr',
          occurredAt: answeredAt,
          correlationId,
          subject: { type: 'pbx_call', id: subjectId },
          actor: { type: 'system', id: 'pbx_cdr_scanner' },
          idempotencyKey: `pbx_call_event:${tenantId}:${cdrId}:answered`,
        payload: { ...basePayload, answeredAt: answeredAt.toISOString(), related },
        }).then(() => { emitted += 1; }).catch(() => {});
      }

      // 3) Ended
      await appendEventV1({
        tenantId,
        type: 'CallEnded',
        source: 'pbx.cdr',
        occurredAt: endedAt,
        correlationId,
        subject: { type: 'pbx_call', id: subjectId },
        actor: { type: 'system', id: 'pbx_cdr_scanner' },
        idempotencyKey: `pbx_call_event:${tenantId}:${cdrId}:ended`,
        payload: { ...basePayload, endedAt: endedAt.toISOString(), related },
      }).then(() => { emitted += 1; }).catch(() => {});

      endedCalls.push({
        tenantId,
        cdrId: json.id,
        uniqueid: json.uniqueid || null,
        src: json.src || null,
        dst: json.dst || null,
        disposition: json.disposition || null,
        duration: durationSec,
        billsec,
        endedAt: endedAt.toISOString(),
      });
    }

    await sequelize.query(
      `UPDATE pbx_call_event_state
       SET last_calldate = :ts, last_cdr_id = :cid, updated_at = NOW()
       WHERE consumer = :consumer`,
      { replacements: { ts: maxCalldate, cid: maxCdrId || null, consumer: String(consumer) }, transaction: t },
    );

    const cursor = { calldate: maxCalldate.toISOString(), cdrId: maxCdrId || null };
    try {
      logger.info('[PBX CallEvents] scan concluído', { consumer, scanned: rows.length, emitted, cursor });
    } catch (_) {}
    return { ok: true, scanned: rows.length, emitted, cursor };
  });

  // Voice + Digital: depois do commit, cada chamada encerrada vira mensagem
  // de voz no Inbox (best-effort — nunca derruba o scan).
  let bridged = 0;
  if (scanResult?.ok && endedCalls.length > 0) {
    // eslint-disable-next-line global-require
    const { recordCallToInbox } = require('./voiceInboxBridgeService');
    for (const call of endedCalls) {
      if (!call.tenantId || call.tenantId === 'unknown') continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await recordCallToInbox({ tenantId: call.tenantId, call })
        .catch((err) => ({ bridged: false, reason: err?.message || 'bridge_error' }));
      if (result?.bridged && !result?.skipped) bridged += 1;
    }
  }

  // Gravações: descobre .wav novos e liga recordingId/transcrição às
  // mensagens de voz já no Inbox (best-effort, por tenant com chamada no lote).
  // Roda em todo lote com chamadas — não só quando houve bridge novo — porque
  // o MixMonitor pode finalizar o .wav depois do bridge da chamada anterior.
  let recordingsLinked = 0;
  if (scanResult?.ok && endedCalls.length > 0) {
    // eslint-disable-next-line global-require
    const { scanAndUpsertRecordings } = require('./pbxRecordingsService');
    const tenantKeys = [...new Set(endedCalls.map((c) => c.tenantId).filter((t) => t && t !== 'unknown'))];
    for (const tenantKey of tenantKeys) {
      // eslint-disable-next-line no-await-in-loop
      const scan = await scanAndUpsertRecordings({ tenantKey })
        .catch(() => null);
      if (scan?.upserted) recordingsLinked += scan.upserted;
    }
  }

  return { ...scanResult, inboxBridged: bridged, recordingsUpserted: recordingsLinked };
}

module.exports = {
  scanPbxCdrAndEmitEvents,
  ensureStateRow,
};

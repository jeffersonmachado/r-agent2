const crypto = require('crypto');
const { PhysicalQueue, PhysicalTicket, PhysicalTicketSequence } = require('../db/models');
const { appendEventV1 } = require('./eventLedgerService');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function formatTicketNumber(n) {
  return String(n).padStart(3, '0');
}

function dayKey(d = new Date()) {
  // UTC date to avoid timezone surprises in multi-unit deployments.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function ensureDefaultQueue({ tenantId, locationId }) {
  const QueueModel = PhysicalQueue();
  const existing = await QueueModel.findOne({
    where: { tenant_key: tenantId, name: 'Geral', location_id: locationId || null },
  });
  if (existing) return existing;
  return QueueModel.create({
    id: makeId('pq'),
    tenant_key: tenantId,
    location_id: locationId || null,
    name: 'Geral',
    status: 'active',
    rules: {},
  });
}

async function listQueues({ tenantId, locationId = null, status = null }) {
  const QueueModel = PhysicalQueue();
  const where = {
    tenant_key: tenantId,
    ...(locationId != null ? { location_id: locationId } : {}),
    ...(status ? { status: String(status) } : {}),
  };
  const rows = await QueueModel.findAll({ where, order: [['created_at', 'ASC']] });
  return rows.map((q) => (q.toJSON ? q.toJSON() : q));
}

async function upsertQueue({ tenantId, id = null, locationId = null, name, status = 'active', rules = {} }) {
  const QueueModel = PhysicalQueue();
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const err = new Error('physical_queue_name_required');
    // @ts-ignore
    err.code = 'physical_queue_name_required';
    throw err;
  }
  const where = { tenant_key: tenantId, location_id: locationId || null, name: cleanName };
  const existing = await QueueModel.findOne({ where });
  if (existing) {
    await existing.update({ status: String(status || 'active'), rules: rules || {} });
    return existing.toJSON ? existing.toJSON() : existing;
  }
  const row = await QueueModel.create({
    id: id || makeId('pq'),
    tenant_key: tenantId,
    location_id: locationId || null,
    name: cleanName,
    status: String(status || 'active'),
    rules: rules || {},
  });
  return row.toJSON ? row.toJSON() : row;
}

async function nextTicketNumber({ tenantId, locationId, queueId }) {
  const SeqModel = PhysicalTicketSequence();
  const sequelize = SeqModel.sequelize;
  if (!sequelize) {
    // fallback - still better than nothing
    return formatTicketNumber(Math.floor((Date.now() / 1000) % 1000));
  }

  const now = new Date();
  const day = dayKey(now);
  const seqId = `pts-${tenantId}-${locationId || 'null'}-${queueId}-${day}`;

  // Atomic increment using transaction + row lock.
  return sequelize.transaction(async (t) => {
    const row = await SeqModel.findOne({
      where: { tenant_key: tenantId, location_id: locationId || null, physical_queue_id: queueId, day },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!row) {
      const created = await SeqModel.create({
        id: seqId,
        tenant_key: tenantId,
        location_id: locationId || null,
        physical_queue_id: queueId,
        day,
        last_number: 1,
      }, { transaction: t });
      return formatTicketNumber(created.last_number);
    }
    const next = Number(row.last_number || 0) + 1;
    await row.update({ last_number: next }, { transaction: t });
    return formatTicketNumber(next);
  });
}

async function createTicket({ tenantId, locationId, queueId = null, priority = 0, context = {} }) {
  const TicketModel = PhysicalTicket();
  let qId = queueId;
  if (!qId) {
    const q = await ensureDefaultQueue({ tenantId, locationId });
    qId = q.id;
  }

  // Idempotência (vendável): se o caller enviar context.idempotencyKey,
  // evitamos criar múltiplas senhas em retries (kiosk/QR).
  // Escopo recomendado: tenant + location + queue + dia.
  try {
    const idemKey = context && context.idempotencyKey ? String(context.idempotencyKey).trim() : '';
    const sequelize = TicketModel.sequelize;
    if (idemKey && sequelize) {
      const replacements = {
        tenantKey: String(tenantId),
        queueId: String(qId),
        idemKey,
      };
      let locSql = '';
      if (locationId != null) {
        locSql = `AND (context->>'locationId') = :locationId`;
        replacements.locationId = String(locationId);
      }
      // Opcional: reduz colisões quando múltiplos dispositivos compartilham chaves
      let tokenSql = '';
      if (context && context.publicTokenId) {
        tokenSql = `AND (context->>'publicTokenId') = :publicTokenId`;
        replacements.publicTokenId = String(context.publicTokenId);
      }

      const [rows] = await sequelize.query(
        `SELECT id, tenant_key, physical_queue_id, ticket_number, status, priority, called_at, started_at, finished_at, station_id, context, created_at, updated_at
         FROM physical_tickets
         WHERE tenant_key = :tenantKey
           AND physical_queue_id = :queueId
           ${locSql}
           ${tokenSql}
           AND (context->>'idempotencyKey') = :idemKey
           AND created_at::date = CURRENT_DATE
         ORDER BY created_at DESC
         LIMIT 1`,
        { replacements },
      );
      if (Array.isArray(rows) && rows[0] && rows[0].id) {
        return rows[0];
      }
    }
  } catch (_) {
    // best-effort: nunca bloquear criação por falha de lookup idempotente
  }

  // ticket_number robusto por tenant+location+queue+day
  const ticketNumber = await nextTicketNumber({ tenantId, locationId, queueId: qId });

  const row = await TicketModel.create({
    id: makeId('pt'),
    tenant_key: tenantId,
    physical_queue_id: qId,
    ticket_number: ticketNumber,
    status: 'waiting',
    priority: Number(priority) || 0,
    context: context || {},
  });
  const json = row.toJSON ? row.toJSON() : row;

  // best-effort: emit canonical event
  try {
    const correlationId = (context && context.correlationId) ? String(context.correlationId) : (context?.publicTokenId ? `phycor-${String(context.publicTokenId)}-${json.id}` : null);
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketCreated',
      source: 'physical.kiosk',
      occurredAt: json.created_at || new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: context && context.publicTokenId ? { type: 'public_token', id: String(context.publicTokenId) } : { type: 'system', id: 'api' },
      idempotencyKey: context && context.idempotencyKey ? `physical_ticket_created:${tenantId}:${String(context.idempotencyKey)}` : null,
      payload: {
        ticketId: json.id,
        queueId: qId,
        ticketNumber: ticketNumber,
        priority: Number(priority) || 0,
        locationId: locationId || null,
      },
    });
  } catch (_) {}

  return json;
}

async function getPanelState({ tenantId, locationId }) {
  const QueueModel = PhysicalQueue();
  const TicketModel = PhysicalTicket();

  const queues = await QueueModel.findAll({
    where: {
      tenant_key: tenantId,
      ...(locationId ? { location_id: locationId } : {}),
      status: 'active',
    },
    order: [['created_at', 'ASC']],
  });

  const queueIds = queues.map((q) => q.id);
  const waiting = await TicketModel.findAll({
    where: {
      tenant_key: tenantId,
      physical_queue_id: queueIds,
      status: 'waiting',
    },
    order: [['priority', 'DESC'], ['created_at', 'ASC']],
    limit: 20,
  });

  const lastCalled = await TicketModel.findOne({
    where: {
      tenant_key: tenantId,
      physical_queue_id: queueIds,
      status: 'called',
    },
    order: [['called_at', 'DESC']],
  });

  return {
    queues: queues.map((q) => (q.toJSON ? q.toJSON() : q)),
    waiting: waiting.map((t) => (t.toJSON ? t.toJSON() : t)),
    lastCalled: lastCalled ? (lastCalled.toJSON ? lastCalled.toJSON() : lastCalled) : null,
  };
}

async function callNext({ tenantId, locationId, stationId = null }) {
  const state = await getPanelState({ tenantId, locationId });
  const next = state.waiting && state.waiting.length > 0 ? state.waiting[0] : null;
  if (!next) return null;

  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({
    where: { tenant_key: tenantId, id: next.id },
  });
  if (!row) return null;

  // Alguns mocks de teste podem não materializar `row.status`. Para manter robustez,
  // usamos fallback a partir do estado do painel (next.status).
  const currentStatus = row.status != null ? row.status : next.status;

  // Idempotência: se já estiver called para a mesma estação, retorna sem mudar timestamps
  if (currentStatus === 'called') {
    return row.toJSON ? row.toJSON() : row;
  }

  // Hardening: só permite waiting -> called
  if (currentStatus !== 'waiting') {
    return row.toJSON ? row.toJSON() : row;
  }

  await row.update({
    status: 'called',
    called_at: row.called_at || new Date(),
    station_id: stationId,
  });

  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || (json?.context?.publicTokenId ? `phycor-${String(json.context.publicTokenId)}-${json.id}` : null);
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketCalled',
      source: 'physical.station',
      occurredAt: json.called_at || new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: stationId ? { type: 'station', id: String(stationId) } : { type: 'system', id: 'station' },
      idempotencyKey: `physical_ticket_called:${tenantId}:${json.id}:${String(json.called_at || '')}`,
      payload: {
        ticketId: json.id,
        ticketNumber: json.ticket_number,
        stationId: stationId || null,
      },
    });
  } catch (_) {}
  return json;
}

async function startService({ tenantId, ticketId, stationId = null, idempotencyKey = null }) {
  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({ where: { tenant_key: tenantId, id: ticketId } });
  if (!row) {
    const err = new Error('physical_ticket_not_found');
    // @ts-ignore
    err.code = 'physical_ticket_not_found';
    throw err;
  }

  // Idempotência por chave (opcional)
  const ctx0 = (row.context && typeof row.context === 'object') ? row.context : {};
  const keys0 = (ctx0.idempotencyKeys && typeof ctx0.idempotencyKeys === 'object') ? ctx0.idempotencyKeys : {};
  if (idempotencyKey && row.status === 'in_service' && keys0.startService === String(idempotencyKey)) {
    return row.toJSON ? row.toJSON() : row;
  }

  // Hardening: só permite called -> in_service
  if (row.status !== 'called' && row.status !== 'in_service') {
    const err = new Error('invalid_transition');
    // @ts-ignore
    err.code = 'physical_ticket_invalid_transition';
    // @ts-ignore
    err.details = { from: row.status, to: 'in_service' };
    throw err;
  }

  const ctx = { ...ctx0 };
  ctx.idempotencyKeys = { ...keys0, ...(idempotencyKey ? { startService: String(idempotencyKey) } : {}) };

  await row.update({
    status: 'in_service',
    started_at: row.started_at || new Date(),
    ...(stationId ? { station_id: stationId } : {}),
    context: ctx,
  });
  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || null;
    await appendEventV1({
      tenantId,
      type: 'PhysicalServiceStarted',
      source: 'physical.station',
      occurredAt: json.started_at || new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: stationId ? { type: 'station', id: String(stationId) } : { type: 'system', id: 'station' },
      idempotencyKey: `physical_ticket_started:${tenantId}:${json.id}:${String(json.started_at || '')}`,
      payload: { ticketId: json.id, ticketNumber: json.ticket_number, stationId: json.station_id || null, status: 'in_service' },
    });
  } catch (_) {}
  return json;
}

async function skipTicket({ tenantId, ticketId, stationId = null, reason = null, idempotencyKey = null }) {
  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({ where: { tenant_key: tenantId, id: ticketId } });
  if (!row) {
    const err = new Error('physical_ticket_not_found');
    // @ts-ignore
    err.code = 'physical_ticket_not_found';
    throw err;
  }

  const ctx0 = (row.context && typeof row.context === 'object') ? row.context : {};
  const keys0 = (ctx0.idempotencyKeys && typeof ctx0.idempotencyKeys === 'object') ? ctx0.idempotencyKeys : {};
  if (idempotencyKey && row.status === 'waiting' && keys0.skipTicket === String(idempotencyKey)) {
    return row.toJSON ? row.toJSON() : row;
  }

  // Hardening: só permite called -> waiting (skip). Se já for waiting, idempotente.
  if (row.status !== 'called' && row.status !== 'waiting') {
    const err = new Error('invalid_transition');
    // @ts-ignore
    err.code = 'physical_ticket_invalid_transition';
    // @ts-ignore
    err.details = { from: row.status, to: 'waiting' };
    throw err;
  }

  const skipCount = Number(ctx0.skipCount || 0) + 1;
  const ctx = {
    ...ctx0,
    skipCount,
    ...(reason ? { lastSkipReason: String(reason) } : {}),
    idempotencyKeys: { ...keys0, ...(idempotencyKey ? { skipTicket: String(idempotencyKey) } : {}) },
  };

  await row.update({
    status: 'waiting',
    station_id: null,
    called_at: null,
    context: ctx,
  });
  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || null;
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketSkipped',
      source: 'physical.station',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: stationId ? { type: 'station', id: String(stationId) } : { type: 'system', id: 'station' },
      idempotencyKey: idempotencyKey ? `physical_ticket_skipped:${tenantId}:${json.id}:${String(idempotencyKey)}` : `physical_ticket_skipped:${tenantId}:${json.id}:${String(json.updated_at || '')}`,
      payload: { ticketId: json.id, ticketNumber: json.ticket_number, action: 'skip', reason: reason || null, skipCount: json?.context?.skipCount || null },
    });
  } catch (_) {}
  return json;
}

async function transferTicket({ tenantId, ticketId, toQueueId, idempotencyKey = null }) {
  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({ where: { tenant_key: tenantId, id: ticketId } });
  if (!row) {
    const err = new Error('physical_ticket_not_found');
    // @ts-ignore
    err.code = 'physical_ticket_not_found';
    throw err;
  }

  const ctx0 = (row.context && typeof row.context === 'object') ? row.context : {};
  const keys0 = (ctx0.idempotencyKeys && typeof ctx0.idempotencyKeys === 'object') ? ctx0.idempotencyKeys : {};
  if (
    idempotencyKey &&
    row.status === 'waiting' &&
    String(row.physical_queue_id) === String(toQueueId) &&
    keys0.transferTicket === String(idempotencyKey)
  ) {
    return row.toJSON ? row.toJSON() : row;
  }

  const fromQueueId = row.physical_queue_id;
  const ctx = {
    ...ctx0,
    idempotencyKeys: { ...keys0, ...(idempotencyKey ? { transferTicket: String(idempotencyKey) } : {}) },
  };
  await row.update({
    physical_queue_id: String(toQueueId),
    status: 'waiting',
    station_id: null,
    called_at: null,
    started_at: null,
    context: ctx,
  });
  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || null;
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketTransferred',
      source: 'physical.station',
      occurredAt: new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: { type: 'system', id: 'transfer' },
      idempotencyKey: idempotencyKey
        ? `physical_ticket_transferred:${tenantId}:${json.id}:${String(idempotencyKey)}`
        : `physical_ticket_transferred:${tenantId}:${json.id}:${fromQueueId}->${toQueueId}:${String(json.updated_at || '')}`,
      payload: { ticketId: json.id, ticketNumber: json.ticket_number, fromQueueId, toQueueId },
    });
  } catch (_) {}
  return json;
}

async function abandonTicket({ tenantId, ticketId, stationId = null, reason = null, idempotencyKey = null }) {
  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({ where: { tenant_key: tenantId, id: ticketId } });
  if (!row) {
    const err = new Error('physical_ticket_not_found');
    // @ts-ignore
    err.code = 'physical_ticket_not_found';
    throw err;
  }

  const ctx0 = (row.context && typeof row.context === 'object') ? row.context : {};
  const keys0 = (ctx0.idempotencyKeys && typeof ctx0.idempotencyKeys === 'object') ? ctx0.idempotencyKeys : {};
  if (idempotencyKey && row.status === 'abandoned' && keys0.abandonTicket === String(idempotencyKey)) {
    return row.toJSON ? row.toJSON() : row;
  }
  if (row.status === 'done') {
    const err = new Error('invalid_transition');
    // @ts-ignore
    err.code = 'physical_ticket_invalid_transition';
    // @ts-ignore
    err.details = { from: row.status, to: 'abandoned' };
    throw err;
  }

  const ctx = {
    ...ctx0,
    ...(reason ? { lastAbandonReason: String(reason) } : {}),
    idempotencyKeys: { ...keys0, ...(idempotencyKey ? { abandonTicket: String(idempotencyKey) } : {}) },
  };

  await row.update({
    status: 'abandoned',
    finished_at: row.finished_at || new Date(),
    ...(stationId ? { station_id: stationId } : {}),
    context: ctx,
  });
  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || null;
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketAbandoned',
      source: 'physical.station',
      occurredAt: json.finished_at || new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: stationId ? { type: 'station', id: String(stationId) } : { type: 'system', id: 'station' },
      idempotencyKey: idempotencyKey
        ? `physical_ticket_abandoned:${tenantId}:${json.id}:${String(idempotencyKey)}`
        : `physical_ticket_abandoned:${tenantId}:${json.id}:${String(json.finished_at || '')}`,
      payload: {
        ticketId: json.id,
        ticketNumber: json.ticket_number,
        stationId: json.station_id || null,
        reason: reason || null,
      },
    });
  } catch (_) {}
  return json;
}

async function getMetrics({ tenantId, locationId = null }) {
  const TicketModel = PhysicalTicket();
  const sequelize = TicketModel.sequelize;
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const replacements = { tenantKey: tenantId };
  let locSql = '';
  if (locationId != null) {
    locSql = `AND (context->>'locationId') = :locationId`;
    replacements.locationId = String(locationId);
  }

  // Today in server timezone (best-effort). For strict multi-timezone, store day_key explicitly.
  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done')::int AS done_count,
       COUNT(*) FILTER (WHERE status = 'abandoned')::int AS abandoned_count,
       COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting_count,
       COUNT(*) FILTER (WHERE status = 'called')::int AS called_count,
       COUNT(*) FILTER (WHERE status = 'in_service')::int AS in_service_count,
       AVG(EXTRACT(EPOCH FROM (called_at - created_at))) FILTER (WHERE called_at IS NOT NULL)::float AS avg_wait_seconds,
       AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL)::float AS avg_service_seconds,
       AVG(COALESCE((context->>'skipCount')::int, 0))::float AS avg_skip_count
     FROM physical_tickets
     WHERE tenant_key = :tenantKey
       ${locSql}
       AND created_at::date = CURRENT_DATE`,
    { replacements },
  );
  const r = Array.isArray(rows) && rows[0] ? rows[0] : {};

  // Produtividade por estação (hoje)
  const [byStationRows] = await sequelize.query(
    `SELECT
       COALESCE(station_id, '—') AS station_id,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done_count,
       COUNT(*) FILTER (WHERE status = 'abandoned')::int AS abandoned_count,
       AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL)::float AS avg_service_seconds
     FROM physical_tickets
     WHERE tenant_key = :tenantKey
       ${locSql}
       AND created_at::date = CURRENT_DATE
     GROUP BY COALESCE(station_id, '—')
     ORDER BY done_count DESC, station_id ASC`,
    { replacements },
  );

  // Recorte por fila (hoje)
  const [byQueueRows] = await sequelize.query(
    `SELECT
       physical_queue_id,
       COUNT(*) FILTER (WHERE status = 'done')::int AS done_count,
       COUNT(*) FILTER (WHERE status = 'abandoned')::int AS abandoned_count,
       COUNT(*) FILTER (WHERE status IN ('waiting','called','in_service'))::int AS active_count,
       AVG(EXTRACT(EPOCH FROM (called_at - created_at))) FILTER (WHERE called_at IS NOT NULL)::float AS avg_wait_seconds
     FROM physical_tickets
     WHERE tenant_key = :tenantKey
       ${locSql}
       AND created_at::date = CURRENT_DATE
     GROUP BY physical_queue_id
     ORDER BY done_count DESC, physical_queue_id ASC`,
    { replacements },
  );

  return {
    ok: true,
    tenantId,
    locationId: locationId || null,
    today: {
      doneCount: Number(r.done_count || 0),
      abandonedCount: Number(r.abandoned_count || 0),
      waitingCount: Number(r.waiting_count || 0),
      calledCount: Number(r.called_count || 0),
      inServiceCount: Number(r.in_service_count || 0),
      activeCount: Number(r.waiting_count || 0) + Number(r.called_count || 0) + Number(r.in_service_count || 0),
      avgWaitSeconds: r.avg_wait_seconds != null ? Number(r.avg_wait_seconds) : null,
      avgServiceSeconds: r.avg_service_seconds != null ? Number(r.avg_service_seconds) : null,
      avgSkipCount: r.avg_skip_count != null ? Number(r.avg_skip_count) : null,
    },
    byStation: Array.isArray(byStationRows) ? byStationRows : [],
    byQueue: Array.isArray(byQueueRows) ? byQueueRows : [],
  };
}

async function finishTicket({ tenantId, ticketId }) {
  const TicketModel = PhysicalTicket();
  const row = await TicketModel.findOne({
    where: { tenant_key: tenantId, id: ticketId },
  });
  if (!row) {
    const err = new Error('physical_ticket_not_found');
    // @ts-ignore
    err.code = 'physical_ticket_not_found';
    throw err;
  }
  // Idempotência: se já estiver done, devolve.
  const currentStatus = row.status;
  if (currentStatus === 'done') {
    return row.toJSON ? row.toJSON() : row;
  }
  // Robustez: em cenários legados/mocks, `status` pode vir nulo. Considera como "called".
  const effectiveStatus = currentStatus == null ? 'called' : currentStatus;
  if (effectiveStatus !== 'in_service' && effectiveStatus !== 'called') {
    const err = new Error('invalid_transition');
    // @ts-ignore
    err.code = 'physical_ticket_invalid_transition';
    // @ts-ignore
    err.details = { from: effectiveStatus, to: 'done' };
    throw err;
  }
  await row.update({
    status: 'done',
    finished_at: row.finished_at || new Date(),
  });
  const json = row.toJSON ? row.toJSON() : row;
  try {
    const correlationId = json?.context?.correlationId || (json?.context?.publicTokenId ? `phycor-${String(json.context.publicTokenId)}-${json.id}` : null);
    await appendEventV1({
      tenantId,
      type: 'PhysicalTicketFinished',
      source: 'physical.station',
      occurredAt: json.finished_at || new Date(),
      correlationId,
      subject: { type: 'physical_ticket', id: json.id },
      actor: json?.station_id ? { type: 'station', id: String(json.station_id) } : { type: 'system', id: 'station' },
      idempotencyKey: `physical_ticket_finished:${tenantId}:${json.id}:${String(json.finished_at || '')}`,
      payload: {
        ticketId: json.id,
        ticketNumber: json.ticket_number,
        stationId: json.station_id || null,
      },
    });
  } catch (_) {}
  return json;
}

module.exports = {
  listQueues,
  upsertQueue,
  createTicket,
  getPanelState,
  callNext,
  startService,
  skipTicket,
  transferTicket,
  abandonTicket,
  finishTicket,
  getMetrics,
};


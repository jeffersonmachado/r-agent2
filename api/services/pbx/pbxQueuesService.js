const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function ensurePbxTenantRow(tenantKey) {
  const PbxTenant = models.PbxTenant();
  const existing = await PbxTenant.findOne({ where: { tenantKey } });
  if (existing) return existing;
  return await PbxTenant.create({
    id: makeId('pbx_tenant'),
    tenantKey,
    name: tenantKey,
    status: 'active',
    settings: {},
  });
}

function normalizeQueuePayload(payload) {
  const name = String(payload?.name || '').trim();
  if (!name) {
    const err = new Error('queue_name_required');
    err.code = 'queue_name_required';
    throw err;
  }
  const displayName = payload?.displayName ? String(payload.displayName).trim() : null;
  const strategy = payload?.strategy ? String(payload.strategy).trim() : null;
  const options = payload?.options && typeof payload.options === 'object' ? payload.options : {};
  return { name, displayName, strategy, options };
}

function makeRealtimeQueueName(tenantKey, queueName) {
  // Avoid collisions between tenants on the realtime 'queues' PK (name)
  return `${tenantKey}__${queueName}`;
}

async function materializeQueueToRealtime({ tenantKey, name, strategy, options }) {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');

  const realtimeName = makeRealtimeQueueName(tenantKey, name);
  const timeout = options?.timeout ? Number(options.timeout) : null;
  const retry = options?.retry ? Number(options.retry) : null;
  const wrapuptime = options?.wrapuptime ? Number(options.wrapuptime) : null;
  const maxlen = options?.maxlen ? Number(options.maxlen) : null;

  // Best-effort safety for dev/test stacks where migrations were not applied yet.
  // In production, schema must be managed via migrations.
  await sq.query(
    `CREATE TABLE IF NOT EXISTS pbx_rt_queues (
      name varchar(128) PRIMARY KEY,
      musiconhold varchar(128) NULL,
      announce varchar(128) NULL,
      context varchar(128) NULL,
      timeout integer NULL,
      retry integer NULL,
      wrapuptime integer NULL,
      maxlen integer NULL,
      servicelevel integer NULL,
      strategy varchar(32) NULL,
      joinempty varchar(128) NULL,
      leavewhenempty varchar(128) NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )`
  );

  await sq.query(
    `INSERT INTO pbx_rt_queues (name, strategy, timeout, retry, wrapuptime, maxlen, context, created_at, updated_at)
     VALUES (:name, :strategy, :timeout, :retry, :wrapuptime, :maxlen, :context, NOW(), NOW())
     ON CONFLICT (name) DO UPDATE SET
       strategy = EXCLUDED.strategy,
       timeout = EXCLUDED.timeout,
       retry = EXCLUDED.retry,
       wrapuptime = EXCLUDED.wrapuptime,
       maxlen = EXCLUDED.maxlen,
       context = EXCLUDED.context,
       updated_at = NOW()`,
    {
      replacements: {
        name: realtimeName,
        strategy: strategy || null,
        timeout,
        retry,
        wrapuptime,
        maxlen,
        context: tenantKey,
      },
    }
  );
}

async function listQueues({ tenantKey }) {
  const PbxQueue = models.PbxQueue();
  const items = await PbxQueue.findAll({ where: { tenantKey }, order: [['name', 'ASC']] });
  return items.map(r => r.toJSON());
}

async function upsertQueue({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxQueue = models.PbxQueue();
  const data = normalizeQueuePayload(payload);

  const existing = await PbxQueue.findOne({ where: { tenantKey, name: data.name } });
  const row = existing
    ? await existing.update(data)
    : await PbxQueue.create({ id: makeId('pbx_queue'), tenantKey, ...data });

  // Materialize to realtime (queues table)
  await materializeQueueToRealtime({
    tenantKey,
    name: data.name,
    strategy: data.strategy,
    options: data.options,
  });

  // Best-effort audit event (optional)
  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.queues.upsert',
      resource: 'pbx_queue',
      resourceId: row.id,
      details: { tenantKey, name: data.name },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listQueues,
  upsertQueue,
};


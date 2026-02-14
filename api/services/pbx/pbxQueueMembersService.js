const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { makePjsipId } = require('./pbxId');

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function fnv1a32(str) {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function toQueueMemberUniqueId(queueName, iface) {
  const h = fnv1a32(`${queueName}|${iface}`);
  // fit in signed 32-bit int positive range
  const max = 2147483647;
  return (h % max) + 1;
}

function normalizePayload(payload) {
  const queueId = String(payload?.queueId || '').trim();
  if (!queueId) {
    const err = new Error('queue_id_required');
    err.code = 'queue_id_required';
    throw err;
  }
  const memberType = payload?.memberType ? String(payload.memberType).trim() : 'extension';
  if (!['extension', 'external'].includes(memberType)) {
    const err = new Error('member_type_invalid');
    err.code = 'member_type_invalid';
    throw err;
  }
  const memberRef = String(payload?.memberRef || '').trim();
  if (!memberRef) {
    const err = new Error('member_ref_required');
    err.code = 'member_ref_required';
    throw err;
  }
  const penalty = payload?.penalty === undefined || payload?.penalty === null ? null : Number(payload.penalty);
  const paused = Boolean(payload?.paused || false);
  return { queueId, memberType, memberRef, penalty: Number.isFinite(penalty) ? penalty : null, paused };
}

async function ensureRealtimeQueueMembersTable() {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');
  await sq.query(
    `CREATE TABLE IF NOT EXISTS pbx_rt_queue_members (
      queue_name varchar(80) NOT NULL,
      interface varchar(80) NOT NULL,
      uniqueid integer NOT NULL UNIQUE,
      membername varchar(80) NULL,
      state_interface varchar(80) NULL,
      penalty integer NULL,
      paused integer NULL,
      wrapuptime integer NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (queue_name, interface)
    )`
  );
}

function makeRealtimeQueueName(tenantKey, queueName) {
  return `${tenantKey}__${queueName}`;
}

function makeMemberInterface({ tenantKey, memberType, memberRef }) {
  if (memberType === 'extension') {
    // memberRef é o ramal (ex: "1001")
    const pjsip = makePjsipId(tenantKey, memberRef);
    return `PJSIP/${pjsip}`;
  }
  // external: user fornece interface completa (ex: SIP/trunk-0001, Local/..., PJSIP/...)
  return memberRef;
}

async function materializeMemberToRealtime({ tenantKey, queueName, memberType, memberRef, penalty, paused }) {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');
  await ensureRealtimeQueueMembersTable();

  const rtQueueName = makeRealtimeQueueName(tenantKey, queueName);
  const iface = makeMemberInterface({ tenantKey, memberType, memberRef });
  const uniqueid = toQueueMemberUniqueId(rtQueueName, iface);

  await sq.query(
    `INSERT INTO pbx_rt_queue_members
      (queue_name, interface, uniqueid, membername, state_interface, penalty, paused, wrapuptime, created_at, updated_at)
     VALUES
      (:queue_name, :interface, :uniqueid, :membername, :state_interface, :penalty, :paused, :wrapuptime, NOW(), NOW())
     ON CONFLICT (queue_name, interface) DO UPDATE SET
      membername = EXCLUDED.membername,
      state_interface = EXCLUDED.state_interface,
      penalty = EXCLUDED.penalty,
      paused = EXCLUDED.paused,
      wrapuptime = EXCLUDED.wrapuptime,
      updated_at = NOW()`,
    {
      replacements: {
        queue_name: rtQueueName,
        interface: iface,
        uniqueid,
        membername: memberRef.slice(0, 80),
        state_interface: iface.slice(0, 80),
        penalty: penalty === null ? null : Math.trunc(penalty),
        paused: paused ? 1 : 0,
        wrapuptime: null,
      },
    }
  );
}

async function dematerializeMemberFromRealtime({ tenantKey, queueName, memberType, memberRef }) {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');
  await ensureRealtimeQueueMembersTable();
  const rtQueueName = makeRealtimeQueueName(tenantKey, queueName);
  const iface = makeMemberInterface({ tenantKey, memberType, memberRef });
  await sq.query(
    `DELETE FROM pbx_rt_queue_members WHERE queue_name = :queue_name AND interface = :interface`,
    { replacements: { queue_name: rtQueueName, interface: iface } }
  );
}

async function listQueueMembers({ tenantKey, queueId }) {
  const PbxQueueMember = models.PbxQueueMember();
  const items = await PbxQueueMember.findAll({ where: { tenantKey, queueId }, order: [['createdAt', 'ASC']] });
  return items.map(r => r.toJSON());
}

async function upsertQueueMember({ tenantKey, payload, actorUserId = null }) {
  const PbxQueue = models.PbxQueue();
  const PbxQueueMember = models.PbxQueueMember();
  const data = normalizePayload(payload);

  // resolve queueName
  const queue = await PbxQueue.findOne({ where: { id: data.queueId, tenantKey } });
  if (!queue) {
    const err = new Error('queue_not_found');
    err.code = 'queue_not_found';
    throw err;
  }

  const existing = await PbxQueueMember.findOne({
    where: {
      tenantKey,
      queueId: data.queueId,
      memberType: data.memberType,
      memberRef: data.memberRef,
    },
  });

  const row = existing
    ? await existing.update(data)
    : await PbxQueueMember.create({ id: makeId('pbx_qm'), tenantKey, ...data });

  await materializeMemberToRealtime({
    tenantKey,
    queueName: queue.name,
    memberType: row.memberType,
    memberRef: row.memberRef,
    penalty: row.penalty,
    paused: row.paused,
  });

  void actorUserId;
  return row.toJSON();
}

async function deleteQueueMember({ tenantKey, id, actorUserId = null }) {
  const PbxQueue = models.PbxQueue();
  const PbxQueueMember = models.PbxQueueMember();
  const row = await PbxQueueMember.findOne({ where: { id: String(id), tenantKey } });
  if (!row) return { ok: true, deleted: false };
  const queue = await PbxQueue.findOne({ where: { id: row.queueId, tenantKey } });
  if (queue) {
    await dematerializeMemberFromRealtime({
      tenantKey,
      queueName: queue.name,
      memberType: row.memberType,
      memberRef: row.memberRef,
    });
  }
  await row.destroy();
  void actorUserId;
  return { ok: true, deleted: true };
}

module.exports = {
  listQueueMembers,
  upsertQueueMember,
  deleteQueueMember,
};


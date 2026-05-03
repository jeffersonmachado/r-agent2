const models = require('../../db/models');
const pbxQueueMembers = require('./pbxQueueMembersService');

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 1 || value === 'true') return true;
  if (value === '0' || value === 0 || value === 'false') return false;
  return fallback;
}

function normalizeSnapshotFilters(filters = {}) {
  return {
    queueId: filters.queueId ? String(filters.queueId).trim() : null,
    memberRef: filters.memberRef ? String(filters.memberRef).trim() : null,
    cdrLimit: Math.min(parsePositiveInt(filters.cdrLimit, 50), 250),
    callWindowMinutes: Math.min(parsePositiveInt(filters.callWindowMinutes, 120), 24 * 60),
    activeCallWindowMinutes: Math.min(parsePositiveInt(filters.activeCallWindowMinutes, 15), 120),
  };
}

function inferCallDirection(call, extensionsSet) {
  const src = String(call?.src || '').trim();
  const dst = String(call?.dst || '').trim();
  const srcIsExt = extensionsSet.has(src);
  const dstIsExt = extensionsSet.has(dst);
  if (srcIsExt && !dstIsExt) return 'outbound';
  if (!srcIsExt && dstIsExt) return 'inbound';
  if (srcIsExt && dstIsExt) return 'internal';
  return 'external';
}

async function listOperatorPanelSnapshot({ tenantKey, filters = {} }) {
  const cfg = normalizeSnapshotFilters(filters);

  const PbxQueue = models.PbxQueue();
  const PbxQueueMember = models.PbxQueueMember();
  const PbxExtension = models.PbxExtension();
  const PbxCdr = models.PbxCdr();

  const [queuesRows, membersRows, extensionsRows] = await Promise.all([
    PbxQueue.findAll({ where: { tenantKey }, order: [['name', 'ASC']] }),
    PbxQueueMember.findAll({ where: { tenantKey }, order: [['updatedAt', 'DESC']] }),
    PbxExtension.findAll({ where: { tenantKey }, order: [['extension', 'ASC']] }),
  ]);

  const queues = queuesRows.map((r) => r.toJSON());
  const queueById = new Map(queues.map((q) => [String(q.id), q]));
  const extensions = extensionsRows.map((r) => r.toJSON());
  const extensionByNumber = new Map(extensions.map((e) => [String(e.extension), e]));
  const extensionNumbers = new Set(extensions.map((e) => String(e.extension)));

  let members = membersRows.map((r) => r.toJSON());
  if (cfg.queueId) {
    members = members.filter((m) => String(m.queueId) === cfg.queueId);
  }
  if (cfg.memberRef) {
    members = members.filter((m) => String(m.memberRef) === cfg.memberRef);
  }

  const queueStatsById = new Map();
  const agentByKey = new Map();

  for (const member of members) {
    const queueId = String(member.queueId);
    const queue = queueById.get(queueId);
    const paused = !!member.paused;

    if (!queueStatsById.has(queueId)) {
      queueStatsById.set(queueId, {
        queueId,
        name: queue?.name || null,
        displayName: queue?.displayName || null,
        strategy: queue?.strategy || null,
        totalMembers: 0,
        pausedMembers: 0,
        activeMembers: 0,
      });
    }

    const queueStats = queueStatsById.get(queueId);
    queueStats.totalMembers += 1;
    if (paused) queueStats.pausedMembers += 1;
    else queueStats.activeMembers += 1;

    const agentKey = `${member.memberType}:${member.memberRef}`;
    if (!agentByKey.has(agentKey)) {
      const extensionProfile = member.memberType === 'extension'
        ? extensionByNumber.get(String(member.memberRef))
        : null;

      agentByKey.set(agentKey, {
        agentKey,
        memberType: member.memberType,
        memberRef: member.memberRef,
        extension: member.memberType === 'extension' ? String(member.memberRef) : null,
        displayName: extensionProfile?.displayName || null,
        extensionStatus: extensionProfile?.status || null,
        queueCount: 0,
        pausedQueueCount: 0,
        isPaused: false,
        queues: [],
        updatedAt: toIso(member.updatedAt) || null,
      });
    }

    const agent = agentByKey.get(agentKey);
    agent.queueCount += 1;
    if (paused) agent.pausedQueueCount += 1;
    agent.isPaused = agent.pausedQueueCount > 0;
    agent.queues.push({
      queueId,
      queueName: queue?.name || null,
      queueDisplayName: queue?.displayName || null,
      paused,
      penalty: member.penalty,
    });

    const updatedAtIso = toIso(member.updatedAt);
    if (updatedAtIso && (!agent.updatedAt || updatedAtIso > agent.updatedAt)) {
      agent.updatedAt = updatedAtIso;
    }
  }

  const cdrFrom = new Date(Date.now() - cfg.callWindowMinutes * 60 * 1000);
  const Op = PbxCdr.sequelize.constructor.Op;
  const cdrRows = await PbxCdr.findAll({
    where: {
      tenantKey,
      calldate: { [Op.gte]: cdrFrom },
    },
    order: [['calldate', 'DESC']],
    limit: cfg.cdrLimit,
  });

  const calls = cdrRows.map((r) => {
    const call = r.toJSON();
    const disposition = call.disposition ? String(call.disposition).toUpperCase() : null;
    return {
      uniqueid: call.uniqueid,
      calldate: toIso(call.calldate),
      src: call.src || null,
      dst: call.dst || null,
      disposition,
      duration: call.duration,
      billsec: call.billsec,
      direction: inferCallDirection(call, extensionNumbers),
    };
  });

  const nowTs = Date.now();
  const activeThresholdMs = cfg.activeCallWindowMinutes * 60 * 1000;
  const activeCalls = calls.filter((c) => {
    const disposition = String(c.disposition || '').trim();
    if (disposition) return false;
    const ts = c.calldate ? new Date(c.calldate).getTime() : NaN;
    if (!Number.isFinite(ts)) return false;
    return nowTs - ts <= activeThresholdMs;
  });

  const answeredCalls = calls.filter((c) => String(c.disposition || '').toUpperCase() === 'ANSWERED').length;
  const missedCalls = calls.filter((c) => {
    const d = String(c.disposition || '').toUpperCase();
    return d === 'NO ANSWER' || d === 'BUSY' || d === 'FAILED' || d === 'CONGESTION';
  }).length;

  const agents = Array.from(agentByKey.values()).sort((a, b) => {
    const pausedDiff = Number(b.isPaused) - Number(a.isPaused);
    if (pausedDiff !== 0) return pausedDiff;
    return String(a.memberRef).localeCompare(String(b.memberRef));
  });

  const queuesOut = Array.from(queueStatsById.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  return {
    generatedAt: new Date().toISOString(),
    filters: cfg,
    summary: {
      totalQueues: queuesOut.length,
      totalAgents: agents.length,
      pausedAgents: agents.filter((a) => a.isPaused).length,
      activeAgents: agents.filter((a) => !a.isPaused).length,
      activeCalls: activeCalls.length,
      answeredCalls,
      missedCalls,
    },
    queues: queuesOut,
    agents,
    calls,
  };
}

function normalizeAgentStatusPayload(payload = {}) {
  const memberRef = String(payload.memberRef || '').trim();
  if (!memberRef) {
    const err = new Error('member_ref_required');
    err.code = 'member_ref_required';
    throw err;
  }

  const paused = asBool(payload.paused, null);
  if (paused === null) {
    const err = new Error('paused_required');
    err.code = 'paused_required';
    throw err;
  }

  const queueId = payload.queueId ? String(payload.queueId).trim() : null;
  const memberType = payload.memberType ? String(payload.memberType).trim() : null;
  if (memberType && memberType !== 'extension' && memberType !== 'external') {
    const err = new Error('member_type_invalid');
    err.code = 'member_type_invalid';
    throw err;
  }

  return { memberRef, paused, queueId, memberType };
}

async function setAgentPauseStatus({ tenantKey, payload, actorUserId = null }) {
  const data = normalizeAgentStatusPayload(payload);
  const PbxQueueMember = models.PbxQueueMember();

  const where = {
    tenantKey,
    memberRef: data.memberRef,
  };

  if (data.queueId) where.queueId = data.queueId;
  if (data.memberType) where.memberType = data.memberType;

  const rows = await PbxQueueMember.findAll({ where, order: [['updatedAt', 'DESC']] });
  if (!rows.length) {
    const err = new Error('agent_not_found_in_queues');
    err.code = 'agent_not_found_in_queues';
    throw err;
  }

  const updatedItems = [];
  for (const row of rows) {
    const raw = row.toJSON();
    const next = await pbxQueueMembers.upsertQueueMember({
      tenantKey,
      actorUserId,
      payload: {
        queueId: raw.queueId,
        memberType: raw.memberType,
        memberRef: raw.memberRef,
        penalty: raw.penalty,
        paused: data.paused,
      },
    });
    updatedItems.push(next);
  }

  return {
    ok: true,
    updatedCount: updatedItems.length,
    paused: data.paused,
    items: updatedItems,
  };
}

/**
 * Transferência assistida: origina chamada AMI de `from` para `to`.
 * Utiliza Originate: Channel=PJSIP/<from>, Context/Exten = <to>.
 */
async function assistedTransfer({ tenantKey, payload = {} }) {
  const fromExt = payload?.from ? String(payload.from).trim() : null;
  const toExt = payload?.to ? String(payload.to).trim() : null;
  const context = payload?.context ? String(payload.context).trim() : (tenantKey || 'from-internal');

  if (!fromExt) throw Object.assign(new Error('from (ramal origem) é obrigatório'), { code: 'transfer_from_required' });
  if (!toExt) throw Object.assign(new Error('to (ramal destino) é obrigatório'), { code: 'transfer_to_required' });

  const ami = require('../asterisk/amiClient');
  const result = await ami.originate({
    channel: `PJSIP/${fromExt}`,
    context,
    exten: toExt,
    priority: 1,
    callerId: fromExt,
    timeoutMs: Number(payload?.timeoutMs || 30000),
    variables: { TRANSFER_FROM: fromExt, TRANSFER_TO: toExt, TENANT: tenantKey },
  });

  return {
    ok: true,
    from: fromExt,
    to: toExt,
    context,
    ami: result,
  };
}

/**
 * Callback rápido: cria um CcClick2CallRequest com originação opcional via AMI.
 * payload: { phone, target, ddd?, originate?: { channel, context, exten } }
 */
async function quickCallback({ tenantKey, payload = {}, actorUserId = null }) {
  const phone = payload?.phone ? String(payload.phone).trim() : null;
  const target = payload?.target ? String(payload.target).trim() : phone; // fallback target = phone

  if (!phone) throw Object.assign(new Error('phone é obrigatório para callback'), { code: 'callback_phone_required' });
  if (!target) throw Object.assign(new Error('target é obrigatório para callback'), { code: 'callback_target_required' });

  const ccClick2Call = require('../cc/ccClick2CallService');
  const result = await ccClick2Call.createClick2CallRequest({
    tenantKey,
    actorUserId,
    payload: {
      phone,
      target,
      ddd: payload?.ddd || null,
      extra: {
        source: 'operator_panel_callback',
        actorUserId,
        note: payload?.note || null,
      },
      originate: payload?.originate || null,
    },
  });

  return {
    ok: true,
    phone,
    target,
    callbackId: result?.id || null,
    status: result?.status || 'pending',
  };
}

module.exports = {
  listOperatorPanelSnapshot,
  setAgentPauseStatus,
  assistedTransfer,
  quickCallback,
};

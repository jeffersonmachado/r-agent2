const crypto = require('crypto');
const models = require('../../db/models');
const ami = require('../asterisk/amiClient');

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeErrorField(error, field, fallback = '') {
  let value;

  try {
    value = error?.[field];
  } catch (_) {
    value = null;
  }

  if (value !== null && value !== undefined) return safeString(value, fallback);
  return fallback;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, '');
  return cleaned.slice(0, 40) || null;
}

function normalizeTarget(raw) {
  const s = String(raw || '').trim();
  return s ? s.slice(0, 128) : null;
}

async function createClick2CallRequest({
  tenantKey,
  payload,
  actorUserId = null,
  publicMeta = null, // { tokenId, kind, locationId, meta }
}) {
  const Model = models.CcClick2CallRequest();

  const campaignId = payload?.campaignId ? String(payload.campaignId) : null;
  const target = normalizeTarget(payload?.target);
  const phone = normalizePhone(payload?.phone);
  const ddd = payload?.ddd ? String(payload.ddd).slice(0, 8) : null;
  if (!target) throw Object.assign(new Error('target é obrigatório'), { code: 'click2call_target_required' });
  if (!phone) throw Object.assign(new Error('phone é obrigatório'), { code: 'click2call_phone_required' });

  const extra = {
    ...(payload?.extra && typeof payload.extra === 'object' ? payload.extra : {}),
    public: publicMeta || undefined,
  };

  const row = await Model.create({
    id: makeId('cc_c2c'),
    tenantKey,
    campaignId,
    target,
    ddd,
    phone,
    status: 'pending',
    extra,
  });

  // Originação best-effort (opcional)
  const originateEnabled = String(process.env.AMI_ORIGINATE_ENABLED || '').toLowerCase() === 'true';
  const originatePayload = payload?.originate && typeof payload.originate === 'object' ? payload.originate : null;
  if (originateEnabled && originatePayload?.channel) {
    try {
      const context = originatePayload.context || tenantKey;
      const exten = originatePayload.exten || String(target);
      await ami.originate({
        channel: String(originatePayload.channel),
        context: String(context),
        exten: String(exten),
        priority: originatePayload.priority ? Number(originatePayload.priority) : 1,
        callerId: originatePayload.callerId ? String(originatePayload.callerId) : null,
        timeoutMs: originatePayload.timeoutMs ? Number(originatePayload.timeoutMs) : 30000,
        variables: originatePayload.variables || {},
      });
      await row.update({ status: 'originated' });
    } catch (err) {
      await row.update({
        status: 'failed',
        extra: {
          ...extra,
          originateError: {
            code: safeErrorField(err, 'code', 'ami_error') || 'ami_error',
            message: safeErrorField(err, 'message'),
          },
        },
      });
    }
  }

  void actorUserId;
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    campaignId: row.campaignId,
    target: row.target,
    ddd: row.ddd,
    phone: row.phone,
    status: row.status,
    extra: row.extra || {},
    createdAt: row.createdAt,
  };
}

async function listClick2CallRequests({ tenantKey, limit = 100 }) {
  const Model = models.CcClick2CallRequest();
  const rows = await Model.findAll({
    where: { tenantKey },
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
  });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    campaignId: r.campaignId,
    target: r.target,
    ddd: r.ddd,
    phone: r.phone,
    status: r.status,
    extra: r.extra || {},
    createdAt: r.createdAt,
  }));
}

module.exports = {
  createClick2CallRequest,
  listClick2CallRequests,
};


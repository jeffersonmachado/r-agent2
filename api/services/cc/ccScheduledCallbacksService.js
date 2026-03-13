const crypto = require('crypto');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, '');
  return cleaned.slice(0, 40) || null;
}

function toDateRequired(raw) {
  const d = new Date(raw);
  // eslint-disable-next-line no-restricted-globals
  if (isNaN(d.getTime())) return null;
  return d;
}

async function listScheduledCallbacks({ tenantKey }) {
  const Model = models.CcScheduledCallback();
  const rows = await Model.findAll({ where: { tenantKey }, order: [['scheduledAt', 'ASC']] });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    scheduledAt: r.scheduledAt,
    description: r.description,
    ddd: r.ddd,
    phone: r.phone,
    status: r.status,
    settings: r.settings || {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function upsertScheduledCallback({ tenantKey, payload, actorUserId = null }) {
  const Model = models.CcScheduledCallback();
  const id = payload?.id ? String(payload.id) : null;

  const scheduledAt = toDateRequired(payload?.scheduledAt);
  if (!scheduledAt) throw Object.assign(new Error('scheduledAt inválido'), { code: 'scheduled_at_invalid' });

  const phone = normalizePhone(payload?.phone);
  if (!phone) throw Object.assign(new Error('phone é obrigatório'), { code: 'scheduled_phone_required' });

  const description = payload?.description ? String(payload.description).slice(0, 255) : null;
  const ddd = payload?.ddd ? String(payload.ddd).slice(0, 8) : null;
  const status = payload?.status ? String(payload.status).slice(0, 32) : 'pending';
  const settings = (payload?.settings && typeof payload.settings === 'object') ? payload.settings : {};

  let row = null;
  if (id) row = await Model.findOne({ where: { id, tenantKey } });

  if (!row) {
    row = await Model.create({
      id: id || makeId('cc_sched'),
      tenantKey,
      scheduledAt,
      description,
      ddd,
      phone,
      status,
      settings,
    });
  } else {
    await row.update({ scheduledAt, description, ddd, phone, status, settings });
  }

  void actorUserId;
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    scheduledAt: row.scheduledAt,
    description: row.description,
    ddd: row.ddd,
    phone: row.phone,
    status: row.status,
    settings: row.settings || {},
  };
}

module.exports = {
  listScheduledCallbacks,
  upsertScheduledCallback,
};


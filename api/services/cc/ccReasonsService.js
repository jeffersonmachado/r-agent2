const crypto = require('crypto');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  return s.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\\-]/g, '').slice(0, 40) || null;
}

function normalizeDescription(raw) {
  const s = String(raw || '').trim();
  return s ? s.slice(0, 255) : null;
}

async function listPauseReasons({ tenantKey }) {
  const Model = models.CcPauseReason();
  const rows = await Model.findAll({ where: { tenantKey }, order: [['code', 'ASC']] });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    code: r.code,
    description: r.description,
    active: r.active,
  }));
}

async function upsertPauseReason({ tenantKey, payload, actorUserId = null }) {
  const Model = models.CcPauseReason();
  const code = normalizeCode(payload?.code);
  const description = normalizeDescription(payload?.description);
  const active = payload?.active === undefined ? true : Boolean(payload.active);
  if (!code) throw Object.assign(new Error('code é obrigatório'), { code: 'pause_reason_code_required' });
  if (!description) throw Object.assign(new Error('description é obrigatório'), { code: 'pause_reason_description_required' });

  const existing = await Model.findOne({ where: { tenantKey, code } });
  const row = existing
    ? await existing.update({ description, active })
    : await Model.create({ id: makeId('cc_pause_reason'), tenantKey, code, description, active });

  // auditoria futura: actorUserId (placeholder)
  void actorUserId;
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    code: row.code,
    description: row.description,
    active: row.active,
  };
}

async function listContactReasons({ tenantKey }) {
  const Model = models.CcContactReason();
  const rows = await Model.findAll({ where: { tenantKey }, order: [['code', 'ASC']] });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    code: r.code,
    description: r.description,
    active: r.active,
  }));
}

async function upsertContactReason({ tenantKey, payload, actorUserId = null }) {
  const Model = models.CcContactReason();
  const code = normalizeCode(payload?.code);
  const description = normalizeDescription(payload?.description);
  const active = payload?.active === undefined ? true : Boolean(payload.active);
  if (!code) throw Object.assign(new Error('code é obrigatório'), { code: 'contact_reason_code_required' });
  if (!description) throw Object.assign(new Error('description é obrigatório'), { code: 'contact_reason_description_required' });

  const existing = await Model.findOne({ where: { tenantKey, code } });
  const row = existing
    ? await existing.update({ description, active })
    : await Model.create({ id: makeId('cc_contact_reason'), tenantKey, code, description, active });

  void actorUserId;
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    code: row.code,
    description: row.description,
    active: row.active,
  };
}

module.exports = {
  listPauseReasons,
  upsertPauseReason,
  listContactReasons,
  upsertContactReason,
};


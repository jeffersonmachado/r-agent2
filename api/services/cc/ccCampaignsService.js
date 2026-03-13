const crypto = require('crypto');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeName(raw) {
  const s = String(raw || '').trim();
  return s ? s.slice(0, 255) : null;
}

function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // mantém dígitos + + (E.164)
  const cleaned = s.replace(/[^\d+]/g, '');
  return cleaned.slice(0, 40) || null;
}

function toDateOrNull(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  // eslint-disable-next-line no-restricted-globals
  return isNaN(d.getTime()) ? null : d;
}

async function listCampaigns({ tenantKey }) {
  const Model = models.CcCampaign();
  const rows = await Model.findAll({ where: { tenantKey }, order: [['updatedAt', 'DESC']] });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    name: r.name,
    status: r.status,
    startAt: r.startAt,
    endAt: r.endAt,
    settings: r.settings || {},
    click2callEnabled: r.click2callEnabled,
    recordEnabled: r.recordEnabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function upsertCampaign({ tenantKey, payload, actorUserId = null }) {
  const Model = models.CcCampaign();

  const id = payload?.id ? String(payload.id) : null;
  const name = normalizeName(payload?.name);
  if (!name) throw Object.assign(new Error('name é obrigatório'), { code: 'campaign_name_required' });

  const status = payload?.status ? String(payload.status) : 'draft';
  const startAt = toDateOrNull(payload?.startAt);
  const endAt = toDateOrNull(payload?.endAt);
  const settings = (payload?.settings && typeof payload.settings === 'object') ? payload.settings : {};
  const click2callEnabled = Boolean(payload?.click2callEnabled || false);
  const recordEnabled = Boolean(payload?.recordEnabled || false);

  let row = null;
  if (id) {
    row = await Model.findOne({ where: { id, tenantKey } });
  }
  if (!row) {
    row = await Model.create({
      id: id || makeId('cc_campaign'),
      tenantKey,
      name,
      status,
      startAt,
      endAt,
      settings,
      click2callEnabled,
      recordEnabled,
    });
  } else {
    await row.update({ name, status, startAt, endAt, settings, click2callEnabled, recordEnabled });
  }

  void actorUserId;
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    name: row.name,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    settings: row.settings || {},
    click2callEnabled: row.click2callEnabled,
    recordEnabled: row.recordEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listCampaignList({ tenantKey, campaignId }) {
  const Model = models.CcCampaignListItem();
  const rows = await Model.findAll({ where: { tenantKey, campaignId }, order: [['createdAt', 'DESC']] });
  return rows.map(r => ({
    id: r.id,
    tenantKey: r.tenantKey,
    campaignId: r.campaignId,
    ddd: r.ddd,
    phone: r.phone,
    key: r.key,
    status: r.status,
    attempts: r.attempts,
    extra: r.extra || {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function addCampaignListItems({ tenantKey, campaignId, items }) {
  const Model = models.CcCampaignListItem();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const phone = normalizePhone(it?.phone);
    if (!phone) continue;
    const row = await Model.create({
      id: makeId('cc_campaign_item'),
      tenantKey,
      campaignId,
      ddd: it?.ddd ? String(it.ddd).slice(0, 8) : null,
      phone,
      key: it?.key ? String(it.key).slice(0, 80) : null,
      status: 'pending',
      attempts: 0,
      extra: (it?.extra && typeof it.extra === 'object') ? it.extra : {},
    });
    out.push(row);
  }
  return out.map(r => ({ id: r.id, phone: r.phone }));
}

module.exports = {
  listCampaigns,
  upsertCampaign,
  listCampaignList,
  addCampaignListItems,
};


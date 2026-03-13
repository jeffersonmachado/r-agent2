const crypto = require('crypto');
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

function normalizeDidPayload(payload) {
  const did = String(payload?.did || '').trim();
  if (!did) {
    const err = new Error('did_required');
    err.code = 'did_required';
    throw err;
  }
  const enabled = payload?.enabled === undefined ? true : Boolean(payload.enabled);
  const match = payload?.match && typeof payload.match === 'object' ? payload.match : {};
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  return { did, enabled, match, actions };
}

async function listDids({ tenantKey }) {
  const PbxDid = models.PbxDid();
  const rows = await PbxDid.findAll({ where: { tenantKey }, order: [['did', 'ASC']] });
  return rows.map(r => r.toJSON());
}

async function upsertDid({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxDid = models.PbxDid();
  const data = normalizeDidPayload(payload);

  const existing = await PbxDid.findOne({ where: { tenantKey, did: data.did } });
  const row = existing
    ? await existing.update(data)
    : await PbxDid.create({ id: makeId('pbx_did'), tenantKey, ...data });

  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.dids.upsert',
      resource: 'pbx_did',
      resourceId: row.id,
      details: { tenantKey, did: data.did },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listDids,
  upsertDid,
};


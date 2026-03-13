const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { makeTrunkPjsipId } = require('./pbxId');

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

function normalizeTrunkPayload(payload) {
  const name = String(payload?.name || '').trim();
  if (!name) {
    const err = new Error('trunk_name_required');
    err.code = 'trunk_name_required';
    throw err;
  }
  const type = String(payload?.type || 'pjsip').trim();
  const transport = payload?.transport ? String(payload.transport).trim() : null;
  const status = payload?.status ? String(payload.status).trim() : 'active';

  const auth = payload?.auth && typeof payload.auth === 'object' ? payload.auth : {};
  const aor = payload?.aor && typeof payload.aor === 'object' ? payload.aor : {};
  const endpoint = payload?.endpoint && typeof payload.endpoint === 'object' ? payload.endpoint : {};

  return { name, type, transport, status, auth, aor, endpoint };
}

function normalizeTrunkAuth(auth = {}) {
  const username = auth?.username ?? auth?.user ?? null;
  const password = auth?.password ?? auth?.pass ?? null;
  return {
    username: username ? String(username).trim() : null,
    password: password ? String(password).trim() : null,
  };
}

function normalizeTrunkAor(aor = {}) {
  const contact = aor?.contact ?? aor?.uri ?? aor?.sipUri ?? null;
  const maxContacts = aor?.max_contacts ?? aor?.maxContacts ?? null;
  return {
    contact: contact ? String(contact).trim() : null,
    maxContacts: Number.isFinite(Number(maxContacts)) ? Number(maxContacts) : null,
  };
}

function normalizeTrunkEndpoint(endpoint = {}) {
  const allow = endpoint?.allow ?? null;
  const disallow = endpoint?.disallow ?? null;
  const directMedia = endpoint?.direct_media ?? endpoint?.directMedia ?? null;
  return {
    allow: allow ? String(allow).trim() : null,
    disallow: disallow ? String(disallow).trim() : null,
    directMedia: directMedia ? String(directMedia).trim() : null,
  };
}

async function materializeTrunkToRealtime({ tenantKey, trunk }) {
  if (!trunk || trunk.type !== 'pjsip') return;

  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');

  const id = makeTrunkPjsipId(tenantKey, trunk.name);
  const { username, password } = normalizeTrunkAuth(trunk.auth || {});
  const { contact, maxContacts } = normalizeTrunkAor(trunk.aor || {});
  const { allow, disallow, directMedia } = normalizeTrunkEndpoint(trunk.endpoint || {});

  const defaultAllow = allow || 'ulaw,alaw';
  const defaultDisallow = disallow || 'all';

  // auth (optional)
  if (username) {
    await sq.query(
      `INSERT INTO ps_auths (id, auth_type, username, password, created_at, updated_at)
       VALUES (:id, 'userpass', :username, :password, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         password = EXCLUDED.password,
         updated_at = NOW()`,
      { replacements: { id, username, password: password || '' } },
    );
  }

  // aor (optional contact)
  await sq.query(
    `INSERT INTO ps_aors (id, contact, max_contacts, remove_existing, qualify_frequency, created_at, updated_at)
     VALUES (:id, :contact, :max_contacts, 'yes', 60, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       contact = EXCLUDED.contact,
       max_contacts = EXCLUDED.max_contacts,
       updated_at = NOW()`,
    { replacements: { id, contact, max_contacts: maxContacts } },
  );

  // endpoint
  await sq.query(
    `INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media, dtmf_mode, rewrite_contact, rtp_symmetric, force_rport, ice_support, allow_transfer, allow_subscribe, created_at, updated_at)
     VALUES (:id, :transport, :aors, :auth, :context, :disallow, :allow, :direct_media, 'rfc4733', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       transport = EXCLUDED.transport,
       aors = EXCLUDED.aors,
       auth = EXCLUDED.auth,
       context = EXCLUDED.context,
       disallow = EXCLUDED.disallow,
       allow = EXCLUDED.allow,
       direct_media = EXCLUDED.direct_media,
       updated_at = NOW()`,
    {
      replacements: {
        id,
        transport: trunk.transport || null,
        aors: id,
        auth: username ? id : null,
        context: tenantKey,
        disallow: defaultDisallow,
        allow: defaultAllow,
        direct_media: directMedia || 'no',
      },
    },
  );
}

async function listTrunks({ tenantKey }) {
  const PbxTrunk = models.PbxTrunk();
  const items = await PbxTrunk.findAll({ where: { tenantKey }, order: [['name', 'ASC']] });
  return items.map(r => r.toJSON());
}

async function upsertTrunk({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxTrunk = models.PbxTrunk();
  const data = normalizeTrunkPayload(payload);

  const existing = await PbxTrunk.findOne({ where: { tenantKey, name: data.name } });
  const row = existing
    ? await existing.update(data)
    : await PbxTrunk.create({ id: makeId('pbx_trunk'), tenantKey, ...data });

  // Materialize to realtime (PJSIP) when applicable
  await materializeTrunkToRealtime({ tenantKey, trunk: row.toJSON() });

  // Best-effort audit event (optional)
  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.trunks.upsert',
      resource: 'pbx_trunk',
      resourceId: row.id,
      details: { tenantKey, name: data.name },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listTrunks,
  upsertTrunk,
};


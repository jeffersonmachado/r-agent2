const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { makePjsipId } = require('./pbxId');

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeMac(raw) {
  if (raw == null) return null;
  const mac = String(raw).trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (!mac) return null;
  if (mac.length !== 12) {
    const err = new Error('invalid_mac');
    err.code = 'invalid_mac';
    throw err;
  }
  return mac;
}

function normalizeProvisioning(payload) {
  const prov = payload?.provisioning && typeof payload.provisioning === 'object' ? payload.provisioning : null;
  if (!prov) return null;
  const enabled = !!prov.enabled;
  if (!enabled) return { enabled: false };
  const vendor = String(prov.vendor || '').trim().toLowerCase();
  if (!vendor || !['grandstream', 'avaya'].includes(vendor)) {
    const err = new Error('invalid_provisioning_vendor');
    err.code = 'invalid_provisioning_vendor';
    throw err;
  }
  const mac = normalizeMac(prov.mac);
  if (!mac) {
    const err = new Error('provisioning_mac_required');
    err.code = 'provisioning_mac_required';
    throw err;
  }
  const model = (prov.model ?? null) ? String(prov.model).trim() : null;
  const firmware = (prov.firmware ?? null) ? String(prov.firmware).trim() : null;
  const template = (prov.template ?? null) ? String(prov.template).trim() : null;
  const timezone = (prov.timezone ?? null) ? String(prov.timezone).trim() : null;
  const ntpServer = (prov.ntpServer ?? prov.ntp ?? null) ? String(prov.ntpServer ?? prov.ntp).trim() : null;
  const transport = (prov.transport ?? null) ? String(prov.transport).trim().toLowerCase() : null; // udp|tcp|tls
  const srtp = prov.srtp === true;
  const codecs = Array.isArray(prov.codecs) ? prov.codecs.map((c) => String(c).trim()).filter(Boolean) : null;

  return {
    enabled: true,
    vendor,
    mac,
    model: model || null,
    firmware: firmware || null,
    template: template || null,
    timezone: timezone || null,
    ntpServer: ntpServer || null,
    transport: transport || null,
    srtp,
    codecs: codecs && codecs.length ? codecs : null,
  };
}

function normalizeExtensionPayload(payload) {
  const extension = String(payload?.extension || payload?.ramal || '').trim();
  if (!extension) {
    const err = new Error('extension_required');
    err.code = 'extension_required';
    throw err;
  }

  const authPassword = (payload?.authPassword ?? payload?.senha ?? null) ? String(payload.authPassword ?? payload.senha).trim() : null;
  const provisioning = normalizeProvisioning(payload);

  // Sanity check: provisioning habilitado exige senha forte (mínimo) para evitar parque vulnerável.
  if (provisioning?.enabled) {
    const status = String(payload?.status ?? 'active').trim();
    if (status && status !== 'active') {
      const err = new Error('provisioning_extension_inactive');
      err.code = 'provisioning_extension_inactive';
      err.details = { status };
      throw err;
    }
    const pw = authPassword || '';
    if (pw.length < 8) {
      const err = new Error('weak_extension_password');
      err.code = 'weak_extension_password';
      err.details = { minLength: 8 };
      throw err;
    }
  }

  return {
    extension,
    displayName: (payload?.displayName ?? payload?.nome ?? null) ? String(payload.displayName ?? payload.nome).trim() : null,
    authUsername: (payload?.authUsername ?? payload?.usuario ?? null) ? String(payload.authUsername ?? payload.usuario).trim() : null,
    authPassword,
    calleridName: (payload?.calleridName ?? null) ? String(payload.calleridName).trim() : null,
    calleridNumber: (payload?.calleridNumber ?? null) ? String(payload.calleridNumber).trim() : null,
    status: (payload?.status ?? 'active') ? String(payload.status ?? 'active').trim() : 'active',
    endpointOptions: payload?.endpointOptions && typeof payload.endpointOptions === 'object' ? payload.endpointOptions : {},
    provisioning,
  };
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

async function materializeExtensionToRealtime({ tenantKey, extension, displayName, authUsername, authPassword }) {
  const sq = getSequelize();
  if (!sq) throw new Error('Sequelize não inicializado');

  const id = makePjsipId(tenantKey, extension);
  const username = authUsername || extension;
  const password = authPassword || '';
  const callerid = `${displayName || extension} <${extension}>`;

  const defaultAllow = 'ulaw,alaw';
  const defaultDisallow = 'all';

  await sq.query(
    `INSERT INTO ps_auths (id, auth_type, username, password, created_at, updated_at)
     VALUES (:id, 'userpass', :username, :password, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       updated_at = NOW()`,
    { replacements: { id, username, password } },
  );

  await sq.query(
    `INSERT INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency, created_at, updated_at)
     VALUES (:id, 1, 'yes', 60, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    { replacements: { id } },
  );

  await sq.query(
    `INSERT INTO ps_endpoints (id, aors, auth, context, disallow, allow, direct_media, dtmf_mode, callerid, rewrite_contact, rtp_symmetric, force_rport, ice_support, allow_transfer, allow_subscribe, created_at, updated_at)
     VALUES (:id, :id, :id, :context, :disallow, :allow, 'no', 'rfc4733', :callerid, 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       aors = EXCLUDED.aors,
       auth = EXCLUDED.auth,
       context = EXCLUDED.context,
       disallow = EXCLUDED.disallow,
       allow = EXCLUDED.allow,
       callerid = EXCLUDED.callerid,
       updated_at = NOW()`,
    { replacements: { id, context: tenantKey, disallow: defaultDisallow, allow: defaultAllow, callerid } },
  );
}

async function listExtensions({ tenantKey }) {
  const PbxExtension = models.PbxExtension();
  const items = await PbxExtension.findAll({
    where: { tenantKey },
    order: [['extension', 'ASC']],
  });
  return items.map(r => r.toJSON());
}

async function upsertExtension({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxExtension = models.PbxExtension();
  const data = normalizeExtensionPayload(payload);

  // Evita duas extensões com o mesmo MAC (best-effort via scan do tenant)
  if (data.provisioning?.enabled && data.provisioning.mac) {
    const all = await PbxExtension.findAll({ where: { tenantKey } });
    const conflict = all.find((r) => {
      const json = r.toJSON();
      const prov = json?.endpointOptions?.provisioning || null;
      if (!prov?.enabled) return false;
      if (!prov?.mac) return false;
      return String(prov.mac).toUpperCase() === String(data.provisioning.mac).toUpperCase()
        && String(json.extension) !== String(data.extension);
    });
    if (conflict) {
      const err = new Error('mac_already_assigned');
      err.code = 'mac_already_assigned';
      err.details = { mac: data.provisioning.mac, extension: conflict.extension };
      throw err;
    }
  }

  const existing = await PbxExtension.findOne({ where: { tenantKey, extension: data.extension } });
  const nextEndpointOptions = {
    ...(existing ? (existing.toJSON()?.endpointOptions || {}) : {}),
    ...(data.endpointOptions || {}),
  };
  if (data.provisioning) {
    if (data.provisioning.enabled) nextEndpointOptions.provisioning = data.provisioning;
    else delete nextEndpointOptions.provisioning;
  }

  const row = existing
    ? await existing.update({
      displayName: data.displayName,
      authUsername: data.authUsername,
      authPassword: data.authPassword,
      calleridName: data.calleridName,
      calleridNumber: data.calleridNumber,
      status: data.status,
      endpointOptions: nextEndpointOptions,
    })
    : await PbxExtension.create({
      id: makeId('pbx_ext'),
      tenantKey,
      extension: data.extension,
      displayName: data.displayName,
      authUsername: data.authUsername,
      authPassword: data.authPassword,
      calleridName: data.calleridName,
      calleridNumber: data.calleridNumber,
      voicemailEnabled: false,
      codecs: [],
      endpointOptions: nextEndpointOptions,
      status: data.status,
    });

  await materializeExtensionToRealtime({
    tenantKey,
    extension: data.extension,
    displayName: data.displayName,
    authUsername: data.authUsername,
    authPassword: data.authPassword,
  });

  // Best-effort audit event (optional)
  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.extensions.upsert',
      resource: 'pbx_extension',
      resourceId: row.id,
      details: { tenantKey, extension: data.extension },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listExtensions,
  upsertExtension,
};


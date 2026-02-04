const crypto = require('crypto');
const { PublicAccessToken } = require('../db/models');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function maskToken(token) {
  const s = String(token || '');
  if (s.length <= 12) return '***';
  return `${s.slice(0, 6)}***${s.slice(-4)}`;
}

function normalizeKind(kind) {
  return String(kind || '').trim();
}

/**
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.kind - storefront|kiosk|panel|station
 * @param {string | null} [args.locationId]
 * @param {object} [args.meta]
 * @param {string | Date | null} [args.expiresAt]
 * @param {number | null} [args.expiresInSec]
 * @param {string | null} [args.rotatedFromId]
 */
async function createPublicToken({
  tenantId,
  kind,
  locationId = null,
  meta = {},
  expiresAt = null,
  expiresInSec = null,
  rotatedFromId = null,
}) {
  const Model = PublicAccessToken();
  const id = makeId('pat');
  const token = makeToken();
  const safeKind = normalizeKind(kind);
  let expiresAtValue = null;
  if (expiresAt) {
    expiresAtValue = expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt));
    // invalid date -> null
    if (Number.isNaN(expiresAtValue.getTime())) expiresAtValue = null;
  } else if (expiresInSec != null && !Number.isNaN(Number(expiresInSec))) {
    const sec = Math.max(0, Number(expiresInSec));
    expiresAtValue = sec > 0 ? new Date(Date.now() + sec * 1000) : null;
  }

  const row = await Model.create({
    id,
    tenant_key: tenantId,
    kind: safeKind,
    location_id: locationId,
    token,
    active: true,
    meta,
    expires_at: expiresAtValue,
    revoked_at: null,
    last_used_at: null,
    rotated_from_id: rotatedFromId,
  });
  return {
    id: row.id,
    tenantId: row.tenant_key,
    kind: row.kind,
    locationId: row.location_id,
    token: row.token,
    active: row.active,
    meta: row.meta || {},
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
    rotatedFromId: row.rotated_from_id || null,
    createdAt: row.created_at || null,
  };
}

/**
 * Lista tokens públicos (por tenant).
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string | null} [args.kind]
 * @param {string | null} [args.locationId]
 * @param {boolean | null} [args.active]
 * @param {boolean} [args.includeToken] - default false (retorna token mascarado)
 */
async function listPublicTokens({ tenantId, kind = null, locationId = null, active = null, includeToken = false }) {
  const Model = PublicAccessToken();
  const where = { tenant_key: tenantId };
  if (kind) where.kind = normalizeKind(kind);
  if (locationId !== undefined && locationId !== null) where.location_id = String(locationId);
  if (active === true || active === false) where.active = active;

  const rows = await Model.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 5000,
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_key,
    kind: row.kind,
    locationId: row.location_id || null,
    token: includeToken ? row.token : maskToken(row.token),
    active: row.active === true,
    meta: row.meta || {},
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
    rotatedFromId: row.rotated_from_id || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
}

/**
 * Revoga/desativa um token público.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.tokenId
 * @param {string | null} [args.reason]
 * @param {string | null} [args.rotatedToId]
 */
async function revokePublicToken({ tenantId, tokenId, reason = null, rotatedToId = null }) {
  const Model = PublicAccessToken();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(tokenId) } });
  if (!row) {
    return { ok: false, error: 'token_not_found' };
  }
  if (!row.active) {
    return { ok: true, token: { id: row.id, active: false, revokedAt: row.revoked_at || null } };
  }

  const meta = (row.meta && typeof row.meta === 'object') ? { ...row.meta } : {};
  if (reason) meta.revokedReason = String(reason);
  if (rotatedToId) meta.rotatedToId = String(rotatedToId);

  row.active = false;
  row.revoked_at = new Date();
  row.meta = meta;
  await row.save();

  return {
    ok: true,
    token: {
      id: row.id,
      tenantId: row.tenant_key,
      kind: row.kind,
      locationId: row.location_id || null,
      active: false,
      revokedAt: row.revoked_at || null,
      expiresAt: row.expires_at || null,
      lastUsedAt: row.last_used_at || null,
      meta: row.meta || {},
    },
  };
}

/**
 * Rotaciona um token público: cria um novo e revoga o antigo.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.tokenId
 * @param {string | Date | null} [args.expiresAt]
 * @param {number | null} [args.expiresInSec]
 */
async function rotatePublicToken({ tenantId, tokenId, expiresAt = null, expiresInSec = null }) {
  const Model = PublicAccessToken();
  const oldRow = await Model.findOne({ where: { tenant_key: tenantId, id: String(tokenId) } });
  if (!oldRow) {
    return { ok: false, error: 'token_not_found' };
  }
  if (!oldRow.active) {
    return { ok: false, error: 'token_inactive' };
  }

  const newToken = await createPublicToken({
    tenantId,
    kind: oldRow.kind,
    locationId: oldRow.location_id || null,
    meta: oldRow.meta || {},
    expiresAt,
    expiresInSec,
    rotatedFromId: oldRow.id,
  });

  await revokePublicToken({
    tenantId,
    tokenId: oldRow.id,
    reason: 'rotated',
    rotatedToId: newToken.id,
  });

  return { ok: true, oldTokenId: oldRow.id, newToken };
}

/**
 * Resolve token enviado via querystring.
 *
 * @param {object} args
 * @param {string} args.token
 * @param {string[]} args.allowedKinds
 */
async function resolvePublicToken({ token, allowedKinds }) {
  const Model = PublicAccessToken();
  const row = await Model.findOne({
    where: { token: String(token) },
  });
  if (!row) {
    return { ok: false, error: 'invalid_token' };
  }
  if (!row.active) {
    return { ok: false, error: 'token_inactive' };
  }
  if (row.revoked_at) {
    return { ok: false, error: 'token_revoked' };
  }
  if (row.expires_at) {
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: 'token_expired' };
    }
  }
  if (Array.isArray(allowedKinds) && allowedKinds.length > 0 && !allowedKinds.includes(row.kind)) {
    return { ok: false, error: 'token_kind_not_allowed' };
  }

  // Best-effort: atualiza last_used_at sem bloquear a request
  try {
    row.last_used_at = new Date();
    await row.save();
  } catch (_) {}

  return {
    ok: true,
    tokenId: row.id,
    tenantId: row.tenant_key,
    kind: row.kind,
    locationId: row.location_id || null,
    meta: row.meta || {},
    expiresAt: row.expires_at || null,
  };
}

module.exports = {
  createPublicToken,
  resolvePublicToken,
  listPublicTokens,
  revokePublicToken,
  rotatePublicToken,
};


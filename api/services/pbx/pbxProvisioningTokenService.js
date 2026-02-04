/**
 * Provisioning token management (per tenant) - PBX.
 *
 * Stores token in pbx_tenants.settings.provisioningPublicToken
 */

'use strict';

const crypto = require('crypto');
const models = require('../../db/models');

function maskToken(token) {
  const s = String(token || '');
  if (s.length <= 12) return '***';
  return `${s.slice(0, 6)}***${s.slice(-4)}`;
}

async function getProvisioningToken({ tenantKey, includeToken = false }) {
  const PbxTenant = models.PbxTenant();
  const row = await PbxTenant.findOne({ where: { tenantKey } });
  if (!row) return { ok: false, error: 'pbx_tenant_not_found' };
  const json = row.toJSON ? row.toJSON() : row;
  const settings = json?.settings && typeof json.settings === 'object' ? json.settings : {};
  const token = settings?.provisioningPublicToken || null;
  const expiresAtRaw = settings?.provisioningPublicTokenExpiresAt || null;
  const expiresAt = expiresAtRaw ? new Date(String(expiresAtRaw)) : null;
  const hasValidExpiresAt = !!(expiresAt && !Number.isNaN(expiresAt.getTime()));
  const expired = hasValidExpiresAt ? (expiresAt.getTime() <= Date.now()) : false;
  const effectiveToken = expired ? null : token;
  return {
    ok: true,
    token: effectiveToken ? (includeToken ? String(effectiveToken) : maskToken(effectiveToken)) : null,
    hasToken: !!effectiveToken,
    updatedAt: settings?.provisioningPublicTokenUpdatedAt || null,
    expiresAt: hasValidExpiresAt ? expiresAt.toISOString() : null,
    expired,
  };
}

async function rotateProvisioningToken({ tenantKey, actorUserId = null, expiresInSec = null }) {
  const PbxTenant = models.PbxTenant();
  const row = await PbxTenant.findOne({ where: { tenantKey } });
  if (!row) return { ok: false, error: 'pbx_tenant_not_found' };
  const json = row.toJSON ? row.toJSON() : row;
  const settings = (json?.settings && typeof json.settings === 'object') ? { ...json.settings } : {};
  const token = crypto.randomBytes(24).toString('hex');
  settings.provisioningPublicToken = token;
  settings.provisioningPublicTokenUpdatedAt = new Date().toISOString();
  settings.provisioningPublicTokenUpdatedBy = actorUserId ? String(actorUserId) : null;
  if (expiresInSec != null && Number.isFinite(Number(expiresInSec)) && Number(expiresInSec) > 0) {
    const sec = Math.max(1, Math.floor(Number(expiresInSec)));
    settings.provisioningPublicTokenExpiresAt = new Date(Date.now() + sec * 1000).toISOString();
  } else if (expiresInSec === 0) {
    // expiresInSec=0 -> sem expiração
    settings.provisioningPublicTokenExpiresAt = null;
  }
  await row.update({ settings });
  return { ok: true, token, expiresAt: settings.provisioningPublicTokenExpiresAt || null };
}

module.exports = {
  getProvisioningToken,
  rotateProvisioningToken,
};


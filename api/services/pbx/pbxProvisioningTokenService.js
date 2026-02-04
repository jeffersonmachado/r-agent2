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
  return {
    ok: true,
    token: token ? (includeToken ? String(token) : maskToken(token)) : null,
    hasToken: !!token,
    updatedAt: settings?.provisioningPublicTokenUpdatedAt || null,
  };
}

async function rotateProvisioningToken({ tenantKey, actorUserId = null }) {
  const PbxTenant = models.PbxTenant();
  const row = await PbxTenant.findOne({ where: { tenantKey } });
  if (!row) return { ok: false, error: 'pbx_tenant_not_found' };
  const json = row.toJSON ? row.toJSON() : row;
  const settings = (json?.settings && typeof json.settings === 'object') ? { ...json.settings } : {};
  const token = crypto.randomBytes(24).toString('hex');
  settings.provisioningPublicToken = token;
  settings.provisioningPublicTokenUpdatedAt = new Date().toISOString();
  settings.provisioningPublicTokenUpdatedBy = actorUserId ? String(actorUserId) : null;
  await row.update({ settings });
  return { ok: true, token };
}

module.exports = {
  getProvisioningToken,
  rotateProvisioningToken,
};


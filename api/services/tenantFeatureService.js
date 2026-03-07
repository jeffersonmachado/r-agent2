'use strict';

const crypto = require('crypto');
const { TenantFeatureFlag } = require('../db/models');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeFlag(row) {
  const item = row?.toJSON ? row.toJSON() : row;
  return {
    id: item.id,
    tenantId: item.tenant_key,
    featureKey: item.feature_key,
    enabled: item.enabled === true,
    config: item.config_json || {},
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

async function listFlags({ tenantId }) {
  const rows = await TenantFeatureFlag().findAll({
    where: { tenant_key: String(tenantId) },
    order: [['feature_key', 'ASC']],
  });
  return { ok: true, items: rows.map(normalizeFlag) };
}

async function getFlag({ tenantId, featureKey }) {
  const row = await TenantFeatureFlag().findOne({
    where: {
      tenant_key: String(tenantId),
      feature_key: String(featureKey),
    },
  });
  return { ok: true, item: row ? normalizeFlag(row) : null };
}

async function isEnabled(tenantId, featureKey, fallback = false) {
  const out = await getFlag({ tenantId, featureKey });
  if (!out.item) return fallback;
  return out.item.enabled === true;
}

async function upsertFlag({ tenantId, featureKey, enabled = false, config = {} }) {
  const Model = TenantFeatureFlag();
  const existing = await Model.findOne({
    where: {
      tenant_key: String(tenantId),
      feature_key: String(featureKey),
    },
  });
  const payload = {
    tenant_key: String(tenantId),
    feature_key: safeStr(featureKey),
    enabled: enabled === true,
    config_json: config && typeof config === 'object' ? config : {},
  };
  const row = existing
    ? await existing.update(payload)
    : await Model.create({ id: newId('tff'), ...payload });
  return { ok: true, item: normalizeFlag(row) };
}

module.exports = {
  listFlags,
  getFlag,
  isEnabled,
  upsertFlag,
};

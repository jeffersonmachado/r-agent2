'use strict';

const crypto = require('crypto');

const aclStore = new Map();

function makeId() {
  return `pbx_acl_${crypto.randomUUID()}`;
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function getTenantBucket(tenantKey) {
  const key = safeString(tenantKey).trim();
  if (!key) {
    const err = new Error('tenant_required');
    err.code = 'tenant_required';
    throw err;
  }

  let bucket = aclStore.get(key);
  if (!bucket) {
    bucket = new Map();
    aclStore.set(key, bucket);
  }
  return bucket;
}

function normalizeAclPayload(payload = {}) {
  const id = safeString(payload.id).trim() || null;
  const name = safeString(payload.name).trim();
  if (!name) {
    const err = new Error('acl_name_required');
    err.code = 'acl_name_required';
    throw err;
  }

  return {
    id,
    name,
    description: safeString(payload.description).trim() || null,
    enabled: payload.enabled !== false,
    deny: safeString(payload.deny).trim() || null,
    permit: safeString(payload.permit).trim() || null,
  };
}

async function listAcls({ tenantKey }) {
  const bucket = getTenantBucket(tenantKey);
  return Array.from(bucket.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
}

async function upsertAcl({ tenantKey, payload, actorUserId = null }) {
  const bucket = getTenantBucket(tenantKey);
  const normalized = normalizeAclPayload(payload);
  const now = new Date().toISOString();

  const existing = normalized.id ? bucket.get(normalized.id) : null;
  const id = existing?.id || normalized.id || makeId();
  const item = {
    id,
    name: normalized.name,
    description: normalized.description,
    enabled: normalized.enabled,
    deny: normalized.deny,
    permit: normalized.permit,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: actorUserId || null,
  };

  bucket.set(id, item);
  return item;
}

async function deleteAcl({ tenantKey, id }) {
  const bucket = getTenantBucket(tenantKey);
  const normalizedId = safeString(id).trim();
  if (!normalizedId) {
    const err = new Error('acl_id_required');
    err.code = 'acl_id_required';
    throw err;
  }
  return bucket.delete(normalizedId);
}

module.exports = {
  listAcls,
  upsertAcl,
  deleteAcl,
};

'use strict';

const { getSequelize } = require('../../db/sequelize');
const { CrmOpportunity } = require('../../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function toJson(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

async function listContactOpportunities({ tenantId, contactId, status = 'open', limit = 20 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const contactKey = safeStr(contactId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!contactKey) return { ok: false, error: 'contact_required' };

  const rows = await CrmOpportunity().findAll({
    where: {
      tenant_key: tenantKey,
      contact_id: contactKey,
      ...(safeStr(status) ? { status: safeStr(status) } : {}),
    },
    order: [['updated_at', 'DESC']],
    limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
  });

  return {
    ok: true,
    items: rows.map((row) => toJson(row)),
  };
}

module.exports = {
  listContactOpportunities,
};

'use strict';

const { getSequelize } = require('../../db/sequelize');
const {
  CrmContact,
  CrmOpportunity,
  RevenueOpportunity,
} = require('../../db/models');

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

async function getContactRelationships({ tenantId, contactId }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const contactKey = safeStr(contactId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!contactKey) return { ok: false, error: 'contact_required' };

  const contact = await CrmContact().findOne({
    where: { tenant_key: tenantKey, id: contactKey },
  });
  if (!contact) return { ok: false, error: 'contact_not_found' };

  const opportunityCount = await CrmOpportunity().count({
    where: { tenant_key: tenantKey, contact_id: contactKey },
  });
  const revenueCount = await RevenueOpportunity().count({
    where: {
      tenant_key: tenantKey,
      related_entity_type: 'crm_contact',
      related_entity_id: contactKey,
      status: 'open',
    },
  }).catch(() => 0);

  const contactJson = toJson(contact);
  return {
    ok: true,
    relationships: {
      contactId: contactKey,
      accountId: safeStr(contactJson.account_id),
      opportunitiesCount: Number(opportunityCount || 0),
      revenueOpportunitiesCount: Number(revenueCount || 0),
    },
  };
}

module.exports = {
  getContactRelationships,
};

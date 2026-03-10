'use strict';

const { getSequelize } = require('../../db/sequelize');
const { CrmContact } = require('../../db/models');
const crmEventService = require('./CRMEventService');
const crmRelationshipService = require('./CRMRelationshipService');
const crmOpportunityBridgeService = require('./CRMOpportunityBridgeService');

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

async function getContactOperationalProfile({ tenantId, contactId, timelineLimit = 40 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const contactKey = safeStr(contactId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!contactKey) return { ok: false, error: 'contact_required' };

  const contact = await CrmContact().findOne({
    where: { tenant_key: tenantKey, id: contactKey },
  });
  if (!contact) return { ok: false, error: 'contact_not_found' };

  const [timeline, relationships, opportunities] = await Promise.all([
    crmEventService.listContactTimeline({ tenantId: tenantKey, contactId: contactKey, limit: timelineLimit, offset: 0 }),
    crmRelationshipService.getContactRelationships({ tenantId: tenantKey, contactId: contactKey }),
    crmOpportunityBridgeService.listContactOpportunities({ tenantId: tenantKey, contactId: contactKey, status: null, limit: 50 }),
  ]);

  return {
    ok: true,
    profile: {
      contact: toJson(contact),
      relationships: relationships.ok ? relationships.relationships : null,
      opportunities: opportunities.ok ? opportunities.items : [],
    },
    timeline: timeline.ok ? timeline : { ok: false, items: [], total: 0, limit: 0, offset: 0 },
  };
}

module.exports = {
  getContactOperationalProfile,
};

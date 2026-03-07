'use strict';

const { Op } = require('sequelize');
const { AutonomousWaitingList, CrmContact } = require('../../db/models');
const { newId, getJson } = require('./shared');
const { normalizeChannels, normalizeTimeWindows, normalizeWeekdays } = require('./runtime');

function mapWaitingItem(row) {
  const json = getJson(row);
  return {
    id: json.id,
    tenantId: json.tenant_key,
    contactId: json.contact_id,
    contextType: json.context_type || null,
    contextId: json.context_id || null,
    desiredChannel: json.desired_channel || null,
    serviceType: json.service_type || null,
    ownerId: json.owner_id || null,
    teamId: json.team_id || null,
    preferredWeekdays: json.preferred_weekdays || [],
    preferredTimeWindows: json.preferred_time_windows || [],
    notes: json.notes || null,
    priority: Number(json.priority || 50),
    active: !!json.active,
    expiresAt: json.expires_at ? new Date(json.expires_at).toISOString() : null,
    metadata: json.metadata || {},
    contact: json.contact || null,
  };
}

function normalizeWaitingPayload(payload = {}) {
  return {
    contextType: payload.contextType ? String(payload.contextType) : null,
    contextId: payload.contextId ? String(payload.contextId) : null,
    desiredChannel: normalizeChannels(payload.desiredChannel ? [payload.desiredChannel] : [null])[0] || null,
    serviceType: payload.serviceType ? String(payload.serviceType) : null,
    ownerId: payload.ownerId ? String(payload.ownerId) : null,
    teamId: payload.teamId ? String(payload.teamId) : null,
    preferredWeekdays: normalizeWeekdays(payload.preferredWeekdays),
    preferredTimeWindows: normalizeTimeWindows(payload.preferredTimeWindows),
    notes: payload.notes ? String(payload.notes).slice(0, 4000) : null,
    priority: Math.max(1, Math.min(100, Number(payload.priority) || 50)),
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt).toISOString() : null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
}

async function getTenantContact({ tenantId, contactId }) {
  const contact = await CrmContact().findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(contactId),
    },
  });
  if (!contact) {
    const err = new Error('crm_contact_not_found');
    err.code = 'crm_contact_not_found';
    throw err;
  }
  return contact;
}

function enrichWithContact(item, contact) {
  const contactJson = contact ? getJson(contact) : null;
  return {
    ...item,
    contact: contactJson ? {
      id: contactJson.id,
      name: contactJson.name || null,
      phone: contactJson.phone || null,
      email: contactJson.email || null,
    } : null,
  };
}

async function findEquivalentActiveEntry({ tenantId, contactId, normalized, excludeId = null }) {
  const rows = await AutonomousWaitingList().findAll({
    where: {
      tenant_key: String(tenantId),
      contact_id: String(contactId),
      active: true,
      ...(excludeId ? { id: { [Op.ne]: String(excludeId) } } : {}),
    },
    order: [['created_at', 'ASC']],
  });
  return rows.find((row) => {
    const item = mapWaitingItem(row);
    return String(item.contextType || '') === String(normalized.contextType || '')
      && String(item.contextId || '') === String(normalized.contextId || '')
      && String(item.desiredChannel || '') === String(normalized.desiredChannel || '')
      && String(item.serviceType || '') === String(normalized.serviceType || '')
      && String(item.ownerId || '') === String(normalized.ownerId || '')
      && String(item.teamId || '') === String(normalized.teamId || '');
  }) || null;
}

async function addWaitingEntry({
  tenantId,
  contactId,
  contextType = null,
  contextId = null,
  desiredChannel = null,
  serviceType = null,
  ownerId = null,
  teamId = null,
  preferredWeekdays = [],
  preferredTimeWindows = [],
  notes = null,
  priority = 50,
  expiresAt = null,
  metadata = {},
}) {
  if (!contactId) {
    const err = new Error('contact_id_required');
    err.code = 'contact_id_required';
    throw err;
  }

  const contact = await getTenantContact({ tenantId, contactId });
  const normalized = normalizeWaitingPayload({
    contextType,
    contextId,
    desiredChannel,
    serviceType,
    ownerId,
    teamId,
    preferredWeekdays,
    preferredTimeWindows,
    notes,
    priority,
    expiresAt,
    metadata,
  });
  const equivalent = await findEquivalentActiveEntry({ tenantId, contactId, normalized });
  if (equivalent) {
    return { ok: true, created: false, item: enrichWithContact(mapWaitingItem(equivalent), contact) };
  }

  const row = await AutonomousWaitingList().create({
    id: newId('awl'),
    tenant_key: String(tenantId),
    contact_id: String(contactId),
    context_type: normalized.contextType,
    context_id: normalized.contextId,
    desired_channel: normalized.desiredChannel,
    service_type: normalized.serviceType,
    owner_id: normalized.ownerId,
    team_id: normalized.teamId,
    preferred_weekdays: normalized.preferredWeekdays,
    preferred_time_windows: normalized.preferredTimeWindows,
    notes: normalized.notes,
    priority: normalized.priority,
    active: true,
    expires_at: normalized.expiresAt ? new Date(normalized.expiresAt) : null,
    metadata: normalized.metadata,
  });
  return { ok: true, created: true, item: enrichWithContact(mapWaitingItem(row), contact) };
}

async function updateWaitingEntry({ tenantId, waitingListId, patch = {} }) {
  const row = await AutonomousWaitingList().findOne({
    where: {
      tenant_key: String(tenantId),
      id: String(waitingListId),
    },
  });
  if (!row) {
    const err = new Error('autonomous_waiting_list_not_found');
    err.code = 'autonomous_waiting_list_not_found';
    throw err;
  }
  const current = mapWaitingItem(row);
  const normalized = normalizeWaitingPayload({
    ...current,
    ...patch,
    desiredChannel: patch.desiredChannel === undefined ? current.desiredChannel : patch.desiredChannel,
  });
  const equivalent = await findEquivalentActiveEntry({
    tenantId,
    contactId: current.contactId,
    normalized,
    excludeId: waitingListId,
  });
  if (equivalent) {
    const err = new Error('autonomous_waiting_list_duplicate');
    err.code = 'autonomous_waiting_list_duplicate';
    throw err;
  }

  await row.update({
    context_type: normalized.contextType,
    context_id: normalized.contextId,
    desired_channel: normalized.desiredChannel,
    service_type: normalized.serviceType,
    owner_id: normalized.ownerId,
    team_id: normalized.teamId,
    preferred_weekdays: normalized.preferredWeekdays,
    preferred_time_windows: normalized.preferredTimeWindows,
    notes: normalized.notes,
    priority: normalized.priority,
    expires_at: normalized.expiresAt ? new Date(normalized.expiresAt) : null,
    metadata: normalized.metadata,
    active: patch.active === undefined ? row.active : !!patch.active,
  });
  const contact = await getTenantContact({ tenantId, contactId: current.contactId });
  return { ok: true, item: enrichWithContact(mapWaitingItem(row), contact) };
}

async function deactivateWaitingEntry({ tenantId, waitingListId }) {
  return updateWaitingEntry({ tenantId, waitingListId, patch: { active: false } });
}

async function listEligibleWaitingEntries({ tenantId, serviceType = null, ownerId = null, teamId = null, activeOnly = true, now = new Date() }) {
  const where = {
    tenant_key: String(tenantId),
    [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: now } }],
  };
  if (activeOnly) where.active = true;
  if (serviceType) where.service_type = String(serviceType);
  if (ownerId) where.owner_id = String(ownerId);
  if (teamId) where.team_id = String(teamId);
  const rows = await AutonomousWaitingList().findAll({ where, order: [['priority', 'DESC'], ['created_at', 'ASC']] });
  const contactIds = rows.map((row) => String(row.contact_id));
  const contacts = contactIds.length > 0
    ? await CrmContact().findAll({ where: { tenant_key: String(tenantId), id: { [Op.in]: contactIds } } })
    : [];
  const contactsById = new Map(contacts.map((row) => [String(row.id), getJson(row)]));
  return {
    ok: true,
    items: rows.map((row) => enrichWithContact(mapWaitingItem(row), contactsById.get(String(row.contact_id)))),
  };
}

module.exports = {
  addWaitingEntry,
  updateWaitingEntry,
  deactivateWaitingEntry,
  listEligibleWaitingEntries,
  mapWaitingItem,
};

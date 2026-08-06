const repository = require('./accessControlRepository');
const { CREDENTIAL_TYPES, DEVICE_TYPES, ANTI_PASSBACK_MODES } = require('./constants');
const { makeId, hashCredential } = require('./utils');
const { emitEvent } = require('../../services/websocketService');
const logger = require('../../utils/logger');

// Notifica páginas operacionais via WebSocket quando uma membership é criada. Best-effort.
function emitMembershipCreated({ tenantId, membershipId, vertical }) {
  if (!tenantId) return;
  try {
    emitEvent('vertical.memberships.updated', { tenantId, entityId: membershipId, action: 'created', vertical }, { tenantId: String(tenantId) });
  } catch (error) {
    logger.warn('[AccessControl] Falha ao emitir vertical.memberships.updated', {
      error: error && error.message ? error.message : String(error),
    });
  }
}

function assertAllowed(value, allowed, code) {
  if (!allowed.includes(String(value))) {
    const err = new Error(code);
    err.code = code;
    throw err;
  }
}

async function ensureSubject({ tenantId, subjectId, customerId, membershipId = null, verticalProfile = 'fitness', metadata = {} }) {
  if (subjectId) {
    const existing = await repository.findSubject({ tenantId, where: { id: String(subjectId) } });
    if (existing) return existing;
  }
  if (customerId) {
    const existing = await repository.findSubject({ tenantId, where: { customer_id: String(customerId) } });
    if (existing) return existing;
  }

  return repository.createSubject({
    id: subjectId || makeId('acs'),
    tenant_key: tenantId,
    customer_id: customerId || null,
    membership_id: membershipId || null,
    status: 'active',
    vertical_profile: verticalProfile || 'fitness',
    metadata,
  });
}

async function upsertMembership({ tenantId, subjectId, membershipId, vertical = 'fitness', customerId = null, planName = null, billingStatus = 'active', status = 'active', unitScope = [], metadata = {} }) {
  if (!membershipId) return null;
  const existing = await repository.findMembership({ tenantId, where: { id: String(membershipId) } });
  if (existing) return existing;
  const created = await repository.createMembership({
    id: String(membershipId),
    tenant_key: tenantId,
    subject_id: String(subjectId),
    customer_id: customerId || null,
    vertical,
    plan_name: planName,
    billing_status: billingStatus,
    status,
    unit_scope: Array.isArray(unitScope) ? unitScope : [],
    metadata,
  });
  emitMembershipCreated({ tenantId, membershipId: String(membershipId), vertical });
  return created;
}

async function listDevices({ tenantId }) {
  return repository.listDevices({ tenantId, order: [['created_at', 'ASC']] });
}

async function getDevice({ tenantId, id }) {
  if (!id) return null;
  return repository.findDevice({ tenantId, where: { id: String(id) } });
}

async function createDevice({ tenantId, payload }) {
  assertAllowed(payload.type, DEVICE_TYPES, 'invalid_access_device_type');
  return repository.createDevice({
    id: payload.id || makeId('acd'),
    tenant_key: tenantId,
    name: String(payload.name || '').trim(),
    type: String(payload.type),
    vendor: payload.vendor || null,
    model: payload.model || null,
    ip: payload.ip || null,
    location: payload.location || null,
    unit_id: payload.unit_id || payload.unitId || null,
    integration_mode: payload.integration_mode || payload.integrationMode || 'backend_decides',
    status: payload.status || 'active',
    metadata: payload.metadata || {},
  });
}

async function patchDevice({ tenantId, id, payload }) {
  if (payload.type) assertAllowed(payload.type, DEVICE_TYPES, 'invalid_access_device_type');
  return repository.patchDevice({ tenantId, id, values: payload });
}

async function listPolicies({ tenantId }) {
  return repository.listPolicies({ tenantId, order: [['created_at', 'ASC']] });
}

async function createPolicy({ tenantId, payload }) {
  if (payload.anti_passback_mode) {
    assertAllowed(payload.anti_passback_mode, ANTI_PASSBACK_MODES, 'invalid_access_policy_anti_passback_mode');
  }
  return repository.createPolicy({
    id: payload.id || makeId('acp'),
    tenant_key: tenantId,
    name: String(payload.name || '').trim(),
    vertical: payload.vertical || 'fitness',
    applies_to: payload.applies_to || payload.appliesTo || {},
    days_allowed: Array.isArray(payload.days_allowed || payload.daysAllowed) ? (payload.days_allowed || payload.daysAllowed) : [],
    time_start: payload.time_start || payload.timeStart || null,
    time_end: payload.time_end || payload.timeEnd || null,
    unit_scope: Array.isArray(payload.unit_scope || payload.unitScope) ? (payload.unit_scope || payload.unitScope) : [],
    max_entries_per_day: payload.max_entries_per_day || payload.maxEntriesPerDay || null,
    anti_passback_mode: payload.anti_passback_mode || payload.antiPassbackMode || 'none',
    grace_policy: payload.grace_policy || payload.gracePolicy || {},
    metadata: payload.metadata || {},
  });
}

async function patchPolicy({ tenantId, id, payload }) {
  if (payload.anti_passback_mode) {
    assertAllowed(payload.anti_passback_mode, ANTI_PASSBACK_MODES, 'invalid_access_policy_anti_passback_mode');
  }
  return repository.patchPolicy({ tenantId, id, values: payload });
}

async function listCredentials({ tenantId }) {
  return repository.listCredentials({ tenantId, order: [['created_at', 'DESC']] });
}

async function createCredential({ tenantId, payload }) {
  assertAllowed(payload.type, CREDENTIAL_TYPES, 'invalid_access_credential_type');
  const subject = await ensureSubject({
    tenantId,
    subjectId: payload.subject_id || payload.subjectId || null,
    customerId: payload.customer_id || payload.customerId || null,
    membershipId: payload.membership_id || payload.membershipId || null,
    verticalProfile: payload.vertical_profile || payload.verticalProfile || payload.vertical || 'fitness',
    metadata: payload.subject_metadata || payload.subjectMetadata || {},
  });

  if (payload.membership_id || payload.membershipId) {
    await upsertMembership({
      tenantId,
      subjectId: subject.id,
      membershipId: payload.membership_id || payload.membershipId,
      vertical: payload.vertical || payload.vertical_profile || 'fitness',
      customerId: payload.customer_id || payload.customerId || null,
      planName: payload.plan_name || payload.planName || null,
      billingStatus: payload.billing_status || payload.billingStatus || 'active',
      status: payload.membership_status || 'active',
      unitScope: payload.unit_scope || payload.unitScope || [],
      metadata: payload.membership_metadata || payload.membershipMetadata || {},
    });
  }

  const rawCredential = payload.credential_value || payload.credentialValue || payload.credential_ref || payload.credentialRef || null;
  return repository.createCredential({
    id: payload.id || makeId('acc'),
    tenant_key: tenantId,
    subject_id: subject.id,
    type: String(payload.type),
    status: payload.status || 'active',
    credential_hash: rawCredential ? hashCredential(rawCredential) : (payload.credential_hash || payload.credentialHash || null),
    credential_ref: payload.credential_ref || payload.credentialRef || null,
    metadata: payload.metadata || {},
    expires_at: payload.expires_at || payload.expiresAt || null,
  });
}

async function patchCredential({ tenantId, id, payload }) {
  if (payload.type) assertAllowed(payload.type, CREDENTIAL_TYPES, 'invalid_access_credential_type');
  const values = { ...payload };
  if (payload.credential_value || payload.credentialValue) {
    values.credential_hash = hashCredential(payload.credential_value || payload.credentialValue);
  }
  return repository.patchCredential({ tenantId, id, values });
}

async function listEvents({ tenantId, filters = {} }) {
  const where = {};
  if (filters.subject_id) where.subject_id = String(filters.subject_id);
  if (filters.device_id) where.device_id = String(filters.device_id);
  if (filters.event_type) where.event_type = String(filters.event_type);
  return repository.listEvents({ tenantId, where, order: [['occurred_at', 'DESC']], limit: Math.min(Number(filters.limit) || 200, 500) });
}

async function listDecisions({ tenantId, filters = {} }) {
  const where = {};
  if (filters.subject_id) where.subject_id = String(filters.subject_id);
  if (filters.device_id) where.device_id = String(filters.device_id);
  if (filters.decision) where.decision = String(filters.decision);
  if (filters.reason_code) where.reason_code = String(filters.reason_code);
  return repository.listDecisions({
    tenantId,
    where,
    order: [['issued_at', 'DESC']],
    limit: Math.min(Number(filters.limit) || 100, 300),
  });
}

async function createEvent({ tenantId, payload }) {
  return repository.createEvent({
    id: payload.id || makeId('ace'),
    tenant_key: tenantId,
    device_id: payload.device_id || payload.deviceId || null,
    subject_id: payload.subject_id || payload.subjectId || null,
    credential_id: payload.credential_id || payload.credentialId || null,
    decision_id: payload.decision_id || payload.decisionId || null,
    event_type: payload.event_type || payload.eventType,
    direction: payload.direction || null,
    reason_code: payload.reason_code || payload.reasonCode || null,
    occurred_at: payload.occurred_at || payload.occurredAt || new Date(),
    raw_payload: payload.raw_payload || payload.rawPayload || {},
    metadata: payload.metadata || {},
  });
}

module.exports = {
  ensureSubject,
  upsertMembership,
  listDevices,
  getDevice,
  createDevice,
  patchDevice,
  listPolicies,
  createPolicy,
  patchPolicy,
  listCredentials,
  createCredential,
  patchCredential,
  listDecisions,
  listEvents,
  createEvent,
};

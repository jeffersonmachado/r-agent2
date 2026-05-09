'use strict';

const fs = require('fs');
const path = require('path');
const { getOperationalStepContract, resolveJourneyId } = require('../../../qa/contracts/operationalStepRegistry');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const SNAPSHOT_CONTRACTS_PATH = path.join(ROOT_DIR, 'config', 'state-snapshot-contracts.json');

let defaultModels = null;

function getDefaultModels() {
  if (defaultModels) return defaultModels;
  try {
    defaultModels = require('../../db/models');
  } catch (_) {
    defaultModels = {};
  }
  return defaultModels;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (_) {
    return {};
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function loadSnapshotContracts(overrideContracts = null) {
  if (overrideContracts && typeof overrideContracts === 'object') return overrideContracts;
  return readJsonSafe(SNAPSHOT_CONTRACTS_PATH, {});
}

function getByPath(object, rawPath) {
  const pathParts = String(rawPath || '').split('.').filter(Boolean);
  let current = object;
  for (const part of pathParts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function rowToPlain(row) {
  if (!row) return null;
  if (typeof row.get === 'function') return row.get({ plain: true });
  if (typeof row.toJSON === 'function') return row.toJSON();
  return cloneJson(row);
}

async function modelCall(models, modelName, method, args = []) {
  try {
    const getter = models?.[modelName];
    const model = typeof getter === 'function' ? getter() : getter;
    if (!model || typeof model[method] !== 'function') {
      return { ok: false, reason: `${modelName}.${method}_unavailable`, value: null };
    }
    const value = await model[method](...args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: `${modelName}.${method}_failed:${error.message}`, value: null };
  }
}

function buildWhere(base = {}, ids = {}) {
  const where = { ...base };
  for (const [key, value] of Object.entries(ids)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      where[key] = String(value);
    }
  }
  return where;
}

async function countModel(models, modelName, where) {
  const result = await modelCall(models, modelName, 'count', [{ where }]);
  return {
    count: result.ok ? Number(result.value || 0) : 0,
    ok: result.ok,
    reason: result.reason || null,
  };
}

async function countModelWithFallback(models, modelName, primaryWhere, fallbackWhere) {
  const primary = await countModel(models, modelName, primaryWhere);
  const hasFallback = isObject(fallbackWhere) && Object.keys(fallbackWhere).length > 0;
  const sameWhere = hasFallback && JSON.stringify(primaryWhere || {}) === JSON.stringify(fallbackWhere || {});

  if (!hasFallback || sameWhere || primary.count > 0) {
    return { ...primary, fallbackApplied: false };
  }

  const fallback = await countModel(models, modelName, fallbackWhere);
  if (fallback.ok && fallback.count > 0) {
    return {
      count: fallback.count,
      ok: primary.ok || fallback.ok,
      reason: fallback.reason || primary.reason || null,
      fallbackApplied: true,
    };
  }

  return { ...primary, fallbackApplied: false };
}

async function findOneModel(models, modelName, where, options = {}) {
  const result = await modelCall(models, modelName, 'findOne', [{ where, ...options }]);
  return {
    item: result.ok ? rowToPlain(result.value) : null,
    ok: result.ok,
    reason: result.reason || null,
  };
}

function normalizeJourneyId(journeyId = '') {
  return resolveJourneyId(journeyId) || String(journeyId || '');
}

function getRequiredSources(journeyId) {
  const normalized = normalizeJourneyId(journeyId);
  if (normalized === 'support_ticket_flow') {
    return ['db', 'api', 'support', 'crm', 'audit'];
  }
  if (normalized === 'fitness_customer_checkin') {
    return ['db', 'api', 'crm', 'devices', 'attendance'];
  }
  if (normalized === 'booking_flow') {
    return ['db', 'api', 'booking'];
  }
  return ['db', 'api'];
}

function normalizeSnapshotContext(options = {}) {
  const seedData = options.seed?.data || options.seed || {};
  const seedEvidence = options.seedEvidence || options.seed?.seedEvidence || {};
  const seedProvision = seedEvidence.provision || {};
  const context = options.context || {};
  const scenario = options.scenario || {};
  return {
    tenantId: options.tenantId || context.tenantId || seedData.tenantId || seedData.tenant_key || 'system',
    journeyId: normalizeJourneyId(options.journeyId || scenario.journeyId || scenario.journey || scenario.id || ''),
    ticketId: options.ticketId || context.ticketId || seedEvidence.ticketId || seedProvision.ticketId || seedProvision.ticket_id || seedData.ticketId || seedData.ticket_id || null,
    conversationId: options.conversationId || context.conversationId || seedEvidence.conversationId || seedEvidence.conversation_id || seedProvision.conversationId || seedProvision.conversation_id || seedData.conversationId || seedData.conversation_id || null,
    contactId: options.contactId || context.contactId || seedEvidence.contactId || seedEvidence.contact_id || seedEvidence.customerId || seedEvidence.customer_id || seedProvision.contactId || seedProvision.contact_id || seedProvision.customerId || seedProvision.customer_id || seedData.contactId || seedData.contact_id || seedData.customerId || seedData.customer_id || null,
    subjectId: options.subjectId || context.subjectId || seedEvidence.subjectId || seedEvidence.subject_id || seedProvision.subjectId || seedProvision.subject_id || seedData.subjectId || seedData.subject_id || null,
    membershipId: options.membershipId || context.membershipId || seedEvidence.membershipId || seedEvidence.membership_id || seedProvision.membershipId || seedProvision.membership_id || seedData.membershipId || seedData.membership_id || null,
    credentialId: options.credentialId || context.credentialId || seedEvidence.credentialId || seedEvidence.credential_id || seedProvision.credentialId || seedProvision.credential_id || seedData.credentialId || seedData.credential_id || null,
    deviceId: options.deviceId || context.deviceId || seedEvidence.deviceId || seedEvidence.device_id || seedProvision.deviceId || seedProvision.device_id || seedData.deviceId || seedData.device_id || null,
    deviceMode: options.deviceMode || context.deviceMode || seedEvidence.deviceMode || seedEvidence.device_mode || seedProvision.deviceMode || seedProvision.device_mode || seedData.deviceMode || seedData.device_mode || null,
    bookingId: options.bookingId || context.bookingId || seedData.bookingId || seedData.booking_id || null,
    replayId: options.replayId || context.replayId || null,
    executionId: options.executionId || context.executionId || null,
    seedEvidence,
  };
}

async function collectSupportTicketSnapshot(ctx, models) {
  const tenantWhere = buildWhere({ tenant_key: ctx.tenantId }, {});
  const ticketWhere = buildWhere(tenantWhere, { id: ctx.ticketId });
  const conversationWhere = buildWhere(tenantWhere, { conversation_id: ctx.conversationId });
  const ticket = ctx.ticketId
    ? await findOneModel(models, 'Ticket', ticketWhere)
    : await findOneModel(models, 'Ticket', tenantWhere, { order: [['updated_at', 'DESC']] });
  const ticketRow = ticket.item || {};
  const ticketId = ticketRow.id || ctx.ticketId || null;
  const conversationId = ticketRow.conversation_id || ctx.conversationId || null;

  const messageWhere = conversationId
    ? buildWhere({ tenant_key: ctx.tenantId, conversation_id: conversationId }, {})
    : ticketWhere;
  const messageCount = await countModel(models, 'ChannelMessage', messageWhere);
  const auditEvents = await countModel(models, 'AuditEvent', buildWhere({ tenant_key: ctx.tenantId }, {
    resource_id: ticketId,
  }));
  const auditLogs = await countModel(models, 'AuditLog', buildWhere({}, { entity_id: ticketId }));
  const crmEvents = await countModel(models, 'VerticalJourneyEvent', buildWhere({
    tenant_key: ctx.tenantId,
  }, {
    customer_id: ctx.contactId,
  }));

  return {
    state: ticketRow.status ? inferStateFromSnapshot({ db: { ticketStatus: ticketRow.status } }, 'ticket_open') : null,
    db: {
      ticket: {
        exists: Boolean(ticketRow.id),
        id: ticketRow.id || null,
        status: ticketRow.status || null,
        messages: {
          count: messageCount.count,
        },
        updatedAt: ticketRow.updatedAt || ticketRow.updated_at || null,
      },
      ticketStatus: ticketRow.status || null,
    },
    api: {
      support: { ticketId, conversationId },
    },
    crm: {
      activities: { count: crmEvents.count, source: 'VerticalJourneyEvent', available: crmEvents.ok },
    },
    events: {
      audit: {
        count: auditEvents.count + auditLogs.count,
        auditEventsAvailable: auditEvents.ok,
        auditLogsAvailable: auditLogs.ok,
      },
      messages: { count: messageCount.count, available: messageCount.ok },
    },
    metadata: {
      sources: {
        db: ticket.ok && messageCount.ok,
        api: true,
        crm: crmEvents.ok,
        audit: auditEvents.ok || auditLogs.ok,
        support: ticket.ok,
        ticket: ticket.ok,
        messages: messageCount.ok,
        auditEvents: auditEvents.ok,
        auditLogs: auditLogs.ok,
      },
      sourceErrors: [ticket.reason, messageCount.reason, auditEvents.reason, auditLogs.reason, crmEvents.reason].filter(Boolean),
    },
  };
}

async function collectFitnessCheckinSnapshot(ctx, models) {
  const tenantWhere = { tenant_key: ctx.tenantId };
  const subjectWhere = buildWhere(tenantWhere, {
    id: ctx.subjectId,
    customer_id: ctx.contactId,
    membership_id: ctx.membershipId,
  });
  const subject = Object.keys(subjectWhere).length > 1
    ? await findOneModel(models, 'AccessSubject', subjectWhere)
    : await findOneModel(models, 'AccessSubject', tenantWhere, { order: [['updated_at', 'DESC']] });
  const subjectRow = subject.item || {};
  const subjectId = ctx.subjectId || subjectRow.id || null;
  const membershipId = ctx.membershipId || subjectRow.membership_id || null;

  const membership = await findOneModel(models, 'AccessMembership', buildWhere(tenantWhere, {
    id: membershipId,
    subject_id: subjectId,
  }));
  const credential = await findOneModel(models, 'AccessCredential', buildWhere(tenantWhere, {
    id: ctx.credentialId,
    subject_id: subjectId,
  }));
  const decisions = await countModelWithFallback(models, 'AccessDecision', buildWhere(tenantWhere, {
    subject_id: subjectId,
    credential_id: ctx.credentialId,
    device_id: ctx.deviceId,
  }), buildWhere(tenantWhere, {
    subject_id: subjectId,
  }));
  const accessEvents = await countModelWithFallback(models, 'AccessEvent', buildWhere(tenantWhere, {
    subject_id: subjectId,
    credential_id: ctx.credentialId,
    device_id: ctx.deviceId,
  }), buildWhere(tenantWhere, {
    subject_id: subjectId,
  }));
  const attendance = await countModelWithFallback(models, 'VerticalAttendance', buildWhere(tenantWhere, {
    subject_id: subjectId,
    membership_id: membershipId,
    device_id: ctx.deviceId,
  }), buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
  }));
  const crmEvents = await countModelWithFallback(models, 'VerticalJourneyEvent', buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
    membership_id: membershipId,
  }), buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
  }));

  const membershipRow = membership.item || {};
  const credentialRow = credential.item || {};
  const membershipActive = membershipRow.status === 'active' && membershipRow.billing_status === 'active';
  const credentialExists = Boolean(credentialRow.id);
  const deviceMode = ctx.deviceMode || (ctx.deviceId ? 'device_real_candidate' : 'simulated_device');
  const filterApplied = Boolean(decisions.fallbackApplied || accessEvents.fallbackApplied || attendance.fallbackApplied || crmEvents.fallbackApplied);

  return {
    state: attendance.count > 0 ? 'attendance_created' : (membershipActive && credentialExists ? 'membership_validated' : null),
    db: {
      crm: { contact: { exists: Boolean(subjectRow.id), id: subjectRow.customer_id || ctx.contactId || null } },
      membership: {
        exists: Boolean(membershipRow.id),
        active: membershipActive,
        status: membershipRow.status || null,
        billingStatus: membershipRow.billing_status || null,
      },
      credential: { exists: credentialExists, status: credentialRow.status || null },
      attendance: { count: attendance.count, created: attendance.count > 0, not_exists: attendance.count === 0 },
    },
    api: {
      access: {
        decision: { count: decisions.count, allow: decisions.count > 0 },
      },
    },
    devices: {
      mode: deviceMode,
      deviceId: ctx.deviceId,
      access: {
        decisions: decisions.count,
        events: accessEvents.count,
        releaseEventCreated: accessEvents.count > 0,
      },
    },
    crm: {
      contact: { exists: Boolean(subjectRow.id) },
      presenceActivity: { count: crmEvents.count, created: crmEvents.count > 0 },
    },
    events: {
      access: { count: accessEvents.count, available: accessEvents.ok },
    },
    metadata: {
      sources: {
        db: subject.ok && membership.ok && credential.ok && attendance.ok,
        api: decisions.ok,
        crm: crmEvents.ok,
        devices: accessEvents.ok,
        attendance: attendance.ok,
        subject: subject.ok,
        membership: membership.ok,
        credential: credential.ok,
        accessDecision: decisions.ok,
        accessEvent: accessEvents.ok,
      },
      deviceEvidence: ctx.deviceId ? 'device_real_candidate' : 'simulated_device',
      sourceErrors: [
        subject.reason,
        membership.reason,
        credential.reason,
        decisions.reason,
        accessEvents.reason,
        attendance.reason,
        crmEvents.reason,
      ].filter(Boolean),
      deviceEvidence: deviceMode,
      filterApplied,
    },
  };
}

async function collectBookingSnapshot(ctx, models) {
  const tenantId = ctx.tenantId;
  const booking = ctx.bookingId
    ? await findOneModel(models, 'ResourceBooking', buildWhere({ tenant_id: tenantId }, { id: ctx.bookingId }))
    : await findOneModel(models, 'ResourceBooking', { tenant_id: tenantId }, { order: [['updated_at', 'DESC']] });
  const bookingRow = booking.item || {};
  const bookingCount = await countModel(models, 'ResourceBooking', { tenant_id: tenantId });
  return {
    state: bookingRow.id ? 'booking_created' : 'booking_requested',
    db: {
      booking: {
        exists: Boolean(bookingRow.id),
        id: bookingRow.id || null,
        status: bookingRow.status || null,
        count: bookingCount.count,
      },
    },
    api: { booking: { id: bookingRow.id || ctx.bookingId || null } },
    metadata: {
      sources: { db: booking.ok || bookingCount.ok, api: true, booking: booking.ok || bookingCount.ok },
      sourceErrors: [booking.reason, bookingCount.reason].filter(Boolean),
    },
  };
}

async function collectSupportStepScopedSnapshot(ctx, models, stepId) {
  const contract = getOperationalStepContract(stepId);
  const entityScope = Array.isArray(contract?.entityScope) ? contract.entityScope : [];
  const tenantWhere = buildWhere({ tenant_key: ctx.tenantId }, {});
  const ticketWhere = buildWhere(tenantWhere, { id: ctx.ticketId });
  const ticket = ctx.ticketId
    ? await findOneModel(models, 'Ticket', ticketWhere)
    : await findOneModel(models, 'Ticket', tenantWhere, { order: [['updated_at', 'DESC']] });
  const ticketRow = ticket.item || {};
  const ticketId = ticketRow.id || ctx.ticketId || null;
  const conversationId = ticketRow.conversation_id || ctx.conversationId || null;
  const snapshot = {
    state: ticketRow.status ? inferStateFromSnapshot({ db: { ticketStatus: ticketRow.status } }, 'ticket_open') : null,
    db: {},
    api: {},
    crm: {},
    events: {},
    devices: {},
    metadata: {
      sources: {},
      sourceErrors: [],
      entityScope,
      filterApplied: false,
      collector: 'entity_scoped',
      stepId,
    },
  };

  if (entityScope.some((entity) => entity === 'ticket' || entity === 'ticket.status' || entity === 'messages' || entity === 'audit' || entity === 'crm' || entity === 'notifications')) {
    snapshot.db.ticket = {
      exists: Boolean(ticketRow.id),
      id: ticketRow.id || null,
      status: ticketRow.status || null,
      updatedAt: ticketRow.updatedAt || ticketRow.updated_at || null,
    };
    snapshot.api.support = { ticketId, conversationId };
  }

  if (entityScope.includes('messages')) {
    const messageWhere = conversationId
      ? buildWhere({ tenant_key: ctx.tenantId, conversation_id: conversationId }, {})
      : ticketWhere;
    const messageCount = await countModel(models, 'ChannelMessage', messageWhere);
    snapshot.db.messages = { count: messageCount.count };
    snapshot.events.messages = { count: messageCount.count, available: messageCount.ok };
    snapshot.metadata.sources.messages = messageCount.ok;
    snapshot.metadata.sourceErrors.push(messageCount.reason);
  }

  if (entityScope.includes('audit')) {
    const auditEvents = await countModel(models, 'AuditEvent', buildWhere({ tenant_key: ctx.tenantId }, { resource_id: ticketId }));
    const auditLogs = await countModel(models, 'AuditLog', buildWhere({}, { entity_id: ticketId }));
    snapshot.events.audit = {
      count: auditEvents.count + auditLogs.count,
      auditEventsAvailable: auditEvents.ok,
      auditLogsAvailable: auditLogs.ok,
    };
    snapshot.metadata.sources.audit = auditEvents.ok || auditLogs.ok;
    snapshot.metadata.sourceErrors.push(auditEvents.reason, auditLogs.reason);
  }

  if (entityScope.includes('crm')) {
    const crmEvents = await countModel(models, 'VerticalJourneyEvent', buildWhere({ tenant_key: ctx.tenantId }, { customer_id: ctx.contactId }));
    snapshot.crm.activities = { count: crmEvents.count, source: 'VerticalJourneyEvent', available: crmEvents.ok };
    snapshot.metadata.sources.crm = crmEvents.ok;
    snapshot.metadata.sourceErrors.push(crmEvents.reason);
  }

  if (entityScope.includes('notifications')) {
    const notificationWhere = buildWhere({ tenant_key: ctx.tenantId }, { customer_id: ctx.contactId });
    const notifications = await countModel(models, 'NotificationDelivery', notificationWhere);
    snapshot.events.notifications = {
      count: notifications.count,
      sent: notifications.count,
      available: notifications.ok,
    };
    snapshot.metadata.sources.notifications = notifications.ok;
    snapshot.metadata.sourceErrors.push(notifications.reason);
  }

  snapshot.metadata.sources.db = Boolean(ticket.ok);
  snapshot.metadata.sources.support = Boolean(ticket.ok);
  snapshot.metadata.sources.ticket = Boolean(ticket.ok);
  snapshot.metadata.sourceErrors = snapshot.metadata.sourceErrors.filter(Boolean);
  return normalizeSnapshot(snapshot);
}

async function collectFitnessStepScopedSnapshot(ctx, models, stepId) {
  const contract = getOperationalStepContract(stepId);
  const entityScope = Array.isArray(contract?.entityScope) ? contract.entityScope : [];
  const tenantWhere = { tenant_key: ctx.tenantId };
  const subjectWhere = buildWhere(tenantWhere, {
    id: ctx.subjectId,
    customer_id: ctx.contactId,
    membership_id: ctx.membershipId,
  });
  const subject = Object.keys(subjectWhere).length > 1
    ? await findOneModel(models, 'AccessSubject', subjectWhere)
    : await findOneModel(models, 'AccessSubject', tenantWhere, { order: [['updated_at', 'DESC']] });
  const subjectRow = subject.item || {};
  const subjectId = ctx.subjectId || subjectRow.id || null;
  const membershipId = ctx.membershipId || subjectRow.membership_id || null;

  const membership = await findOneModel(models, 'AccessMembership', buildWhere(tenantWhere, {
    id: membershipId,
    subject_id: subjectId,
  }));
  const credential = await findOneModel(models, 'AccessCredential', buildWhere(tenantWhere, {
    id: ctx.credentialId,
    subject_id: subjectId,
  }));
  const decisions = await countModelWithFallback(models, 'AccessDecision', buildWhere(tenantWhere, {
    subject_id: subjectId,
    credential_id: ctx.credentialId,
    device_id: ctx.deviceId,
  }), buildWhere(tenantWhere, {
    subject_id: subjectId,
  }));
  const accessEvents = await countModelWithFallback(models, 'AccessEvent', buildWhere(tenantWhere, {
    subject_id: subjectId,
    credential_id: ctx.credentialId,
    device_id: ctx.deviceId,
  }), buildWhere(tenantWhere, {
    subject_id: subjectId,
  }));
  const attendance = await countModelWithFallback(models, 'VerticalAttendance', buildWhere(tenantWhere, {
    subject_id: subjectId,
    membership_id: membershipId,
    device_id: ctx.deviceId,
  }), buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
  }));
  const crmEvents = await countModelWithFallback(models, 'VerticalJourneyEvent', buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
    membership_id: membershipId,
  }), buildWhere({
    ...tenantWhere,
    vertical: 'fitness',
  }, {
    subject_id: subjectId,
  }));

  const membershipRow = membership.item || {};
  const credentialRow = credential.item || {};
  const membershipActive = membershipRow.status === 'active' && membershipRow.billing_status === 'active';
  const credentialExists = Boolean(credentialRow.id);
  const deviceMode = ctx.deviceMode || (ctx.deviceId ? 'device_real_candidate' : 'simulated_device');
  const filterApplied = Boolean(decisions.fallbackApplied || accessEvents.fallbackApplied || attendance.fallbackApplied || crmEvents.fallbackApplied);

  const snapshot = {
    state: attendance.count > 0 ? 'attendance_created' : (membershipActive && credentialExists ? 'membership_validated' : null),
    db: {},
    api: {},
    crm: {},
    events: {},
    devices: {},
    metadata: {
      sources: {},
      sourceErrors: [],
      entityScope,
      filterApplied,
      collector: 'entity_scoped',
      stepId,
    },
  };

  if (entityScope.includes('attendance')) {
    snapshot.db.attendance = { count: attendance.count, created: attendance.count > 0, not_exists: attendance.count === 0 };
    snapshot.metadata.sources.attendance = attendance.ok;
  }
  if (entityScope.includes('access_decision')) {
    snapshot.api.access = { decision: { count: decisions.count, allow: decisions.count > 0 } };
    snapshot.metadata.sources.accessDecision = decisions.ok;
  }
  if (entityScope.includes('access_event')) {
    snapshot.devices = {
      mode: deviceMode,
      deviceId: ctx.deviceId,
      access: {
        decisions: decisions.count,
        events: accessEvents.count,
        releaseEventCreated: accessEvents.count > 0,
      },
    };
    snapshot.events.access = { count: accessEvents.count, available: accessEvents.ok };
    snapshot.metadata.sources.accessEvent = accessEvents.ok;
  }
  if (entityScope.some((entity) => entity === 'crm_journey' || entity === 'crm')) {
    snapshot.crm.presenceActivity = { count: crmEvents.count, created: crmEvents.count > 0 };
    snapshot.metadata.sources.crm = crmEvents.ok;
  }

  snapshot.metadata.sources.db = Boolean(subject.ok && membership.ok && credential.ok && attendance.ok);
  snapshot.metadata.sources.subject = subject.ok;
  snapshot.metadata.sources.membership = membership.ok;
  snapshot.metadata.sources.credential = credential.ok;
  snapshot.metadata.sourceErrors = [
    subject.reason,
    membership.reason,
    credential.reason,
    decisions.reason,
    accessEvents.reason,
    attendance.reason,
    crmEvents.reason,
  ].filter(Boolean);

  return normalizeSnapshot(snapshot);
}

async function collectUiState(page = null) {
  if (!page || typeof page.locator !== 'function') {
    return { available: false, reason: 'playwright_page_unavailable' };
  }
  try {
    const url = typeof page.url === 'function' ? page.url() : null;
    const title = typeof page.title === 'function' ? await page.title() : null;
    const supportVisible = await page.locator('[data-testid="support-page"], [data-testid="ticket-list"]').first().isVisible().catch(() => false);
    const ticketDetailVisible = await page.locator('[data-testid="ticket-detail"], [data-testid="ticket-message-list"]').first().isVisible().catch(() => false);
    const replayVisible = await page.locator('[data-testid="rpa-replays-page"]').first().isVisible().catch(() => false);
    return {
      available: true,
      url,
      title,
      support: { visible: supportVisible, ticketDetailVisible },
      replay: { visible: replayVisible },
    };
  } catch (error) {
    return { available: false, reason: `playwright_collect_failed:${error.message}` };
  }
}

function collectReplayState(replay = {}) {
  const screens = Array.isArray(replay.screens) ? replay.screens : [];
  const screenshots = Array.isArray(replay.screenshots) ? replay.screenshots : [];
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const events = Array.isArray(replay.events) ? replay.events : [];
  const urls = new Set();
  for (const item of [...steps, ...events]) {
    const url = item?.url || item?.page || item?.input?.url || item?.evidence?.url;
    if (url) urls.add(String(url));
  }
  return {
    exists: Boolean(replay.replayId || replay.id || steps.length || screens.length || screenshots.length),
    replayId: replay.replayId || replay.id || null,
    screenCount: screens.length || screenshots.length,
    stepCount: steps.length,
    eventCount: events.length,
    urls: Array.from(urls),
    showsOperationalModule: Array.from(urls).some((url) => /\/support|\/fitness|\/access-control|\/calendar|\/bookings/.test(url)),
  };
}

async function collectOperationalSnapshot(options = {}) {
  const models = options.models || getDefaultModels();
  const ctx = normalizeSnapshotContext(options);
  let collected;

  if (ctx.journeyId === 'support_ticket_flow') {
    collected = await collectSupportTicketSnapshot(ctx, models);
  } else if (ctx.journeyId === 'fitness_customer_checkin') {
    collected = await collectFitnessCheckinSnapshot(ctx, models);
  } else if (ctx.journeyId === 'booking_flow') {
    collected = await collectBookingSnapshot(ctx, models);
  } else {
    collected = {
      state: null,
      db: {},
      api: {},
      crm: {},
      events: {},
      devices: {},
      metadata: { sources: {}, sourceErrors: ['journey_snapshot_collector_not_configured'] },
    };
  }

  const ui = await collectUiState(options.page || null);
  const replay = collectReplayState(options.replay || {});

  return normalizeSnapshot({
    ...collected,
    ui,
    replay,
    metadata: {
      ...(collected.metadata || {}),
      phase: options.phase || null,
      collectedAt: new Date().toISOString(),
      journeyId: ctx.journeyId,
      tenantId: ctx.tenantId,
      context: ctx,
      sources: {
        ...((collected.metadata || {}).sources || {}),
        ui: ui.available === true,
        replay: replay.exists === true,
      },
    },
  });
}

function diffObject(before, after) {
  const mutations = [];
  const beforeObj = isObject(before) ? before : {};
  const afterObj = isObject(after) ? after : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of keys) {
    const prev = beforeObj[key];
    const next = afterObj[key];

    if (isObject(prev) && isObject(next)) {
      const nested = diffObject(prev, next);
      for (const item of nested) {
        mutations.push({
          path: `${key}.${item.path}`,
          before: item.before,
          after: item.after,
        });
      }
      continue;
    }

    const same = JSON.stringify(prev) === JSON.stringify(next);
    if (!same) {
      mutations.push({
        path: key,
        before: prev,
        after: next,
      });
    }
  }

  return mutations;
}

function normalizeSnapshot(input = {}) {
  return {
    state: input.state || input.operationalState || null,
    db: cloneJson(input.db),
    api: cloneJson(input.api),
    ui: cloneJson(input.ui),
    replay: cloneJson(input.replay),
    events: cloneJson(input.events),
    crm: cloneJson(input.crm),
    devices: cloneJson(input.devices),
    metadata: cloneJson(input.metadata),
  };
}

function hasSnapshotPayload(snapshot = {}) {
  const normalized = normalizeSnapshot(snapshot);
  if (normalized.state) return true;
  for (const bucket of ['db', 'api', 'ui', 'replay', 'events', 'crm', 'devices']) {
    const value = normalized[bucket];
    if (isObject(value) && Object.keys(value).length > 0) return true;
  }
  return false;
}

function classifySourceErrorReason(reason = '') {
  const text = String(reason || '').toLowerCase();
  if (!text) return 'source_unavailable';
  if (
    text.includes('unavailable')
    || text.includes('probe_missing')
    || text.includes('unreachable')
    || text.includes('model_unavailable')
    || text.includes('failed')
    || text.includes('timeout')
  ) {
    return 'source_unavailable';
  }
  if (text.includes('not_found') || text.includes('missing')) {
    return 'entity_not_found';
  }
  if (text.includes('empty')) {
    return 'empty_state';
  }
  return 'invalid_state';
}

function validateSnapshotEvidence({ journeyId, snapshot, phase = null, contracts = null } = {}) {
  const normalizedJourneyId = normalizeJourneyId(journeyId);
  const normalized = normalizeSnapshot(snapshot || {});
  const sources = normalized.metadata?.sources || {};
  const sourceErrors = Array.isArray(normalized.metadata?.sourceErrors) ? normalized.metadata.sourceErrors : [];
  const requiredSources = getRequiredSources(normalizedJourneyId);
  const sourceIntegrity = requiredSources.map((source) => {
    if (sources[source] === true) {
      return { source, status: 'ok', classification: 'ok' };
    }
    const sourceReason = sourceErrors.find((item) => String(item || '').toLowerCase().includes(source));
    const classification = classifySourceErrorReason(sourceReason);
    return {
      source,
      status: 'failed',
      classification,
      details: sourceReason ? [sourceReason] : sourceErrors,
    };
  });

  const sourceUnavailable = sourceIntegrity
    .filter((item) => item.status === 'failed')
    .map((item) => ({
      reason: item.classification === 'source_unavailable'
        ? 'snapshot_source_unavailable'
        : item.classification === 'entity_not_found'
          ? 'snapshot_entity_not_found'
          : item.classification === 'empty_state'
            ? 'snapshot_empty_state'
            : 'snapshot_invalid_state',
      source: item.source,
      phase,
      details: item.details || [],
    }));

  const empty = !hasSnapshotPayload(normalized);
  const blockers = [...sourceUnavailable];
  if (empty) {
    blockers.push({ reason: 'snapshot_empty', phase });
  }

  if (normalizedJourneyId === 'fitness_customer_checkin' && normalized.metadata?.deviceEvidence === 'simulated_device') {
    blockers.push({
      reason: 'snapshot_invalid_state',
      phase,
      details: ['simulated_device_not_allowed_for_go'],
    });
  }

  let contractResult = null;
  if (phase === 'before' || phase === 'after') {
    const store = loadSnapshotContracts(contracts);
    const contract = store[normalizedJourneyId];
    const entries = Array.isArray(contract?.[phase]) ? contract[phase] : [];
    const singleSnapshotEntries = entries.filter((entry) => !String(entry || '').includes(':incremented'));
    const failures = singleSnapshotEntries
      .map((entry) => validateContractEntry(normalized, entry, phase, {
        before: phase === 'before' ? normalized : {},
        after: phase === 'after' ? normalized : {},
      }))
      .filter((item) => !item.ok)
      .map((item) => ({ ...item, phase, reason: 'snapshot_data_missing' }));
    contractResult = { entries, failures };
    blockers.push(...failures);
  }

  return {
    valid: blockers.length === 0,
    journeyId: normalizedJourneyId,
    phase,
    requiredSources,
    sourceIntegrity,
    sourceUnavailable,
    empty,
    dataMissing: contractResult?.failures || [],
    blockers,
  };
}

function collectSideEffects(before = {}, after = {}) {
  const sideEffects = [];
  const buckets = ['db', 'api', 'ui', 'replay', 'events', 'crm', 'devices'];

  for (const bucket of buckets) {
    const bucketDiff = diffObject(before[bucket], after[bucket]);
    if (bucketDiff.length > 0) {
      sideEffects.push({
        source: bucket,
        mutations: bucketDiff,
      });
    }
  }

  return sideEffects;
}

function inferObservedSideEffectsFromSnapshots(before = {}, after = {}) {
  const snapshots = captureTransitionSnapshots({ before, after });
  const names = new Set();
  const changed = new Set(snapshots.sideEffects.flatMap((source) => source.mutations.map((mutation) => `${source.source}.${mutation.path}`)));

  for (const pathName of changed) {
    if (/ticket\.status|ticketStatus/i.test(pathName)) names.add('ticket_status_changed');
    if (/ticket\.messages\.count|events\.messages\.count/i.test(pathName)) names.add('ticket_message_created');
    if (/crm/i.test(pathName)) {
      names.add('crm_updated');
      names.add('crm_presence_updated');
    }
    if (/audit/i.test(pathName)) names.add('audit_log_created');
    if (/notification/i.test(pathName)) names.add('notification_sent');
    if (/booking/i.test(pathName)) names.add('booking_created');
    if (/attendance/i.test(pathName)) {
      names.add('attendance_recorded');
      names.add('checkin_registered');
    }
    if (/devices|access\.events|releaseEventCreated/i.test(pathName)) {
      names.add('device_event_created');
      names.add('turnstile_released');
    }
    if (/access\.decision/i.test(pathName)) names.add('access_decision_allow');
  }

  return Array.from(names);
}

function captureTransitionSnapshots(options = {}) {
  const before = normalizeSnapshot(options.before || options.initial || {});
  const after = normalizeSnapshot(options.after || options.final || {});

  const sideEffects = collectSideEffects(before, after);

  return {
    before,
    after,
    sideEffects,
    observedSideEffects: inferObservedSideEffectsFromDiff(sideEffects),
    mutationCount: sideEffects.reduce((total, item) => total + item.mutations.length, 0),
  };
}

function inferObservedSideEffectsFromDiff(sideEffects = []) {
  const names = new Set();
  for (const source of sideEffects) {
    for (const mutation of source.mutations || []) {
      const pathName = `${source.source}.${mutation.path}`;
      if (/ticket\.status|ticketStatus/i.test(pathName)) names.add('ticket_status_changed');
      if (/ticket\.messages\.count|events\.messages\.count/i.test(pathName)) names.add('ticket_message_created');
      if (/crm/i.test(pathName)) names.add('crm_updated');
      if (/audit/i.test(pathName)) names.add('audit_log_created');
      if (/notification/i.test(pathName)) names.add('notification_sent');
      if (/booking/i.test(pathName)) names.add('booking_created');
      if (/attendance/i.test(pathName)) {
        names.add('attendance_recorded');
        names.add('checkin_registered');
      }
      if (/devices|access\.events|releaseEventCreated/i.test(pathName)) {
        names.add('device_event_created');
        names.add('turnstile_released');
      }
      if (/presenceActivity|crm\.presence/i.test(pathName)) names.add('crm_presence_updated');
      if (/access\.decision.*allow|api\.access\.decision/i.test(pathName)) names.add('access_decision_allow');
    }
  }
  return Array.from(names);
}

function validateContractEntry(snapshot, entry, phase, snapshots = null) {
  const [rawPath, op] = String(entry || '').split(':');
  const actual = getByPath(snapshot, rawPath);

  if (!op) {
    return {
      ok: hasMeaningfulValue(actual),
      entry,
      path: rawPath,
      expected: 'present',
      actual,
    };
  }

  if (op === 'exists') return { ok: Boolean(actual?.exists ?? actual), entry, path: rawPath, expected: 'exists', actual };
  if (op === 'not_exists') return { ok: actual === true || actual?.exists === false || actual === 0, entry, path: rawPath, expected: 'not_exists', actual };
  if (op === 'created') return { ok: actual === true || actual?.created === true || Number(actual?.count || 0) > 0, entry, path: rawPath, expected: 'created', actual };
  if (op === 'allow') return { ok: actual === true || actual?.allow === true || actual === 'allow', entry, path: rawPath, expected: 'allow', actual };
  if (op === 'incremented') {
    const beforeValue = getByPath(snapshots?.before || {}, rawPath);
    const afterValue = getByPath(snapshots?.after || {}, rawPath);
    return {
      ok: Number(afterValue) > Number(beforeValue),
      entry,
      path: rawPath,
      expected: 'incremented',
      before: beforeValue,
      after: afterValue,
    };
  }

  return { ok: false, entry, path: rawPath, expected: op, actual, reason: `unsupported_contract_operator:${op}` };
}

function validateSnapshotContracts({ journeyId, beforeSnapshot, afterSnapshot, contracts = null } = {}) {
  const normalizedJourneyId = normalizeJourneyId(journeyId);
  const store = loadSnapshotContracts(contracts);
  const contract = store[normalizedJourneyId] || null;
  if (!contract) {
    return {
      valid: false,
      journeyId: normalizedJourneyId,
      missing: [{ phase: 'contract', reason: 'snapshot_contract_missing' }],
      passed: [],
    };
  }

  const before = normalizeSnapshot(beforeSnapshot || {});
  const after = normalizeSnapshot(afterSnapshot || {});
  const failures = [];
  const passed = [];

  for (const entry of contract.before || []) {
    const result = validateContractEntry(before, entry, 'before', { before, after });
    (result.ok ? passed : failures).push({ ...result, phase: 'before' });
  }

  for (const entry of contract.after || []) {
    const result = validateContractEntry(after, entry, 'after', { before, after });
    (result.ok ? passed : failures).push({ ...result, phase: 'after' });
  }

  return {
    valid: failures.length === 0,
    journeyId: normalizedJourneyId,
    contract,
    missing: failures,
    passed,
  };
}

function inferStateFromSnapshot(snapshot = {}, fallback = null) {
  if (snapshot.state) return String(snapshot.state);

  const db = snapshot.db || {};
  const crm = snapshot.crm || {};
  const devices = snapshot.devices || {};

  if (db.ticketStatus) {
    const value = String(db.ticketStatus).toLowerCase();
    if (value.includes('open')) return 'ticket_open';
    if (value.includes('progress')) return 'ticket_in_progress';
    if (value.includes('repl')) return 'ticket_replied';
    if (value.includes('resolv')) return 'ticket_resolved';
  }

  if (devices.turnstile === 'open' || devices.turnstileOpened === true) {
    return 'turnstile_opened';
  }

  if (db.attendanceCreated === true || db.attendanceId) {
    return 'attendance_created';
  }
  if (db.attendance?.created === true || Number(db.attendance?.count || 0) > 0) {
    return 'attendance_created';
  }

  if (crm.updated === true || crm.lastUpdateAt) {
    return 'crm_updated';
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Entity-scoped snapshot collection (Phase 2: semantic consistency)
// ---------------------------------------------------------------------------

/**
 * Filtra um snapshot global para conter apenas entidades relevantes a um step.
 *
 * Utiliza o registry para determinar quais entidades capturar, reduzindo ruído.
 *
 * @param {object} globalSnapshot - snapshot completo coletado
 * @param {string} stepId - identificador do step
 * @returns {object} snapshot filtrado com apenas entidades do escopo
 */
function filterSnapshotByEntityScope(globalSnapshot = {}, stepId = '', options = {}) {
  // GUARD: Esta fun\u00e7\u00e3o \u00e9 LEGADO/DIAGN\u00d3STICO. No pipeline operacional usar collectEntityScopedSnapshot().
  // Chamar sem { diagnosticMode: true } em contexto operacional \u00e9 erro de causalidade.
  if (options?.diagnosticMode !== true) {
    throw new Error(
      `filterSnapshotByEntityScope: uso proibido em contexto operacional para step "${stepId}". ` +
      'Use collectEntityScopedSnapshot() no pipeline operacional. ' +
      'Para diagn\u00f3stico/testes pass options.diagnosticMode = true.'
    );
  }
  const registry = require('../../../qa/contracts/operationalStepRegistry');
  const { getEntityScopeForStep } = registry;

  const entityScope = getEntityScopeForStep(stepId);
  if (!Array.isArray(entityScope) || entityScope.length === 0) {
    // Se não há escopo definido, retorna snapshot global (backward compat)
    return normalizeSnapshot(globalSnapshot);
  }

  const normalized = normalizeSnapshot(globalSnapshot);
  const filtered = {
    state: normalized.state || null,
    db: {},
    api: {},
    ui: normalized.ui || {},
    replay: normalized.replay || {},
    events: {},
    crm: {},
    devices: {},
    metadata: {
      ...normalized.metadata,
      entityScope: entityScope,
      filterApplied: true,
    },
  };

  // Mapear nomes de entidades a buckets de snapshot
  const entityBucketMap = {
    // Database entities
    ticket: 'db',
    messages: 'db',
    message: 'db',
    audit: 'db',
    attendance: 'db',
    access_decision: 'db',
    access_event: 'db',
    subject: 'db',

    // CRM entities
    crm: 'crm',
    crm_activity: 'crm',
    crm_journey: 'crm',
    crm_presence: 'crm',
    crm_updated: 'crm',

    // Access Control
    access_control: 'db',
    turnstile: 'devices',
  };

  // Filtrar db bucket
  for (const entity of entityScope) {
    const bucket = entityBucketMap[entity.toLowerCase()];
    if (bucket === 'db' && normalized.db && typeof normalized.db === 'object') {
      // Manter apenas campos relevantes
      const dbKey = entity.toLowerCase();
      if (normalized.db[dbKey]) {
        filtered.db[dbKey] = normalized.db[dbKey];
      }
      // Também manter singular + 's'
      if (entity.endsWith('s') && normalized.db[entity.substring(0, entity.length - 1)]) {
        filtered.db[entity.substring(0, entity.length - 1)] = 
          normalized.db[entity.substring(0, entity.length - 1)];
      }
    }
  }

  // Filtrar crm bucket
  for (const entity of entityScope) {
    const bucket = entityBucketMap[entity.toLowerCase()];
    if ((bucket === 'crm' || entity.toLowerCase().startsWith('crm')) && 
        normalized.crm && typeof normalized.crm === 'object') {
      const crmKey = entity.toLowerCase();
      if (normalized.crm[crmKey]) {
        filtered.crm[crmKey] = normalized.crm[crmKey];
      }
    }
  }

  // Manter events se solicitado
  if (entityScope.some((e) => e.toLowerCase().includes('event'))) {
    filtered.events = normalized.events || {};
  }

  // Manter devices/access se solicitado
  if (entityScope.some((e) => e.toLowerCase().includes('device') || e.toLowerCase().includes('access'))) {
    filtered.devices = normalized.devices || {};
  }

  return filtered;
}

/**
 * Coleta snapshot entity-scoped para um step específico.
 *
 * Reduz ruído coletando apenas estado relevante ao step em questão.
 *
 * @param {object} options
 * @param {string} options.stepId - qual step
 * @param {string} options.journeyId - qual jornada
 * @param {string} [options.phase] - fase da coleta
 * @param {object} [options.page] - página Playwright (opcional)
 * @param {object} [options.replay] - estado de replay (opcional)
 * @param {object} [options.models] - models ORM (opcional)
 * @returns {Promise<object>} snapshot filtrado
 */
async function collectEntityScopedSnapshot(options = {}) {
  const stepId = options.stepId || '';
  if (!stepId) {
    throw new Error('collectEntityScopedSnapshot requires options.stepId');
  }
  const stepContract = getOperationalStepContract(stepId);
  if (!stepContract) {
    throw new Error(`collectEntityScopedSnapshot requires registered stepId: ${stepId}`);
  }

  const models = options.models || getDefaultModels();
  const ctx = normalizeSnapshotContext(options);

  if (stepContract.journeyId === 'support_ticket_flow') {
    return collectSupportStepScopedSnapshot(ctx, models, stepId);
  }

  if (stepContract.journeyId === 'fitness_customer_checkin') {
    return collectFitnessStepScopedSnapshot(ctx, models, stepId);
  }

  return normalizeSnapshot({
    state: null,
    db: {},
    api: {},
    crm: {},
    events: {},
    devices: {},
    metadata: {
      sources: {},
      sourceErrors: ['entity_scoped_collector_not_configured'],
      entityScope: stepContract.entityScope || [],
      filterApplied: false,
      collector: 'entity_scoped',
      stepId,
    },
  });
}

module.exports = {
  captureTransitionSnapshots,
  collectSideEffects,
  collectOperationalSnapshot,
  collectEntityScopedSnapshot,
  __diagnosticOnlyFilterSnapshotByEntityScope: filterSnapshotByEntityScope,
  __testOnlyNormalizeSnapshotContext: normalizeSnapshotContext,
  collectReplayState,
  getRequiredSources,
  inferObservedSideEffectsFromSnapshots,
  inferStateFromSnapshot,
  loadSnapshotContracts,
  normalizeJourneyId,
  normalizeSnapshot,
  validateSnapshotEvidence,
  validateSnapshotContracts,
};

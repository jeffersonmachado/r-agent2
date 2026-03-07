'use strict';

const crypto = require('crypto');
const { Op, fn, col, where: sqlWhere } = require('sequelize');
const {
  OperationalSchedule,
  ScheduleWorkingHour,
  ScheduleBlock,
  ScheduleReminder,
} = require('../db/models');
const { logAction } = require('./auditService');
const { appendEventV1 } = require('./eventLedgerService');
const {
  normalizeReferenceId,
  getUserById,
  getTeamById,
  canAssignOwner,
  canAssignTeam,
} = require('./identityService');
const logger = require('../utils/logger');
const { resolveCentralAvailability } = require('./operationalAvailabilityService');

const CONTEXT_TYPES = new Set(['ticket', 'crm', 'task', 'system', 'custom']);
const CHANNELS = new Set(['whatsapp', 'voice', 'email', 'internal', 'system']);
const MODES = new Set(['free', 'team_based']);
const ORIGINS = new Set(['bot', 'human', 'system']);
const CONFIRMATION_STATUSES = new Set(['pending', 'confirmed', 'declined', 'not_required']);
const SCHEDULE_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'done', 'no_show', 'canceled']);
const REMINDER_ACTIONS = new Set(['notify', 'request_confirmation', 'mark_no_show']);
const REMINDER_STATUSES = new Set(['pending', 'processing', 'done', 'failed', 'canceled']);
const SCOPE_TYPES = new Set(['team', 'owner']);
const ACTIVE_STATUS_FOR_CONFLICT = new Set(['scheduled', 'in_progress']);

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeEnum(value, allowed, field, fallback = null) {
  const normalized = String(value || fallback || '').trim().toLowerCase();
  if (!normalized || !allowed.has(normalized)) {
    const err = new Error(`${field}_invalid`);
    err.code = `${field}_invalid`;
    throw err;
  }
  return normalized;
}

function normalizeTimeZone(raw) {
  const tz = String(raw || 'UTC').trim();
  return tz || 'UTC';
}

function parseDateRequired(raw, field) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`${field}_invalid`);
    err.code = `${field}_invalid`;
    throw err;
  }
  return d;
}

function sanitizeString(raw, max = 255, fallback = '') {
  const s = raw === null || raw === undefined ? fallback : String(raw).trim();
  return s.slice(0, max);
}

function minutesFromTime(raw) {
  const m = String(raw || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function mapScheduleRow(row) {
  if (!row) return null;
  const json = row.toJSON ? row.toJSON() : row;
  return {
    id: json.id,
    tenantId: json.tenant_key,
    contextType: json.context_type,
    contextId: json.context_id,
    contactId: json.contact_id || null,
    conversationId: json.conversation_id || null,
    channel: json.channel,
    mode: json.mode,
    origin: json.origin,
    startAt: json.start_at ? new Date(json.start_at).toISOString() : null,
    endAt: json.end_at ? new Date(json.end_at).toISOString() : null,
    timezone: json.timezone,
    requiresConfirmation: !!json.requires_confirmation,
    confirmationStatus: json.confirmation_status,
    status: json.status,
    ownerId: json.owner_id || null,
    teamId: json.team_id || null,
    purpose: json.purpose || '',
    notes: json.notes || '',
    metadata: json.metadata || {},
    idempotencyKey: json.idempotency_key || null,
    createdAt: json.created_at ? new Date(json.created_at).toISOString() : (json.createdAt?.toISOString?.() || null),
    updatedAt: json.updated_at ? new Date(json.updated_at).toISOString() : (json.updatedAt?.toISOString?.() || null),
  };
}

function mapWorkingHourRow(row) {
  const json = row.toJSON ? row.toJSON() : row;
  return {
    id: json.id,
    tenantId: json.tenant_key,
    scopeType: json.scope_type,
    scopeId: json.scope_id,
    weekday: Number(json.weekday),
    startTime: json.start_time,
    endTime: json.end_time,
    timezone: json.timezone,
    enabled: !!json.enabled,
    metadata: json.metadata || {},
    createdAt: json.created_at ? new Date(json.created_at).toISOString() : (json.createdAt?.toISOString?.() || null),
    updatedAt: json.updated_at ? new Date(json.updated_at).toISOString() : (json.updatedAt?.toISOString?.() || null),
  };
}

function mapBlockRow(row) {
  const json = row.toJSON ? row.toJSON() : row;
  return {
    id: json.id,
    tenantId: json.tenant_key,
    scopeType: json.scope_type,
    scopeId: json.scope_id,
    startAt: json.start_at ? new Date(json.start_at).toISOString() : null,
    endAt: json.end_at ? new Date(json.end_at).toISOString() : null,
    reason: json.reason || null,
    active: !!json.active,
    metadata: json.metadata || {},
    createdAt: json.created_at ? new Date(json.created_at).toISOString() : (json.createdAt?.toISOString?.() || null),
    updatedAt: json.updated_at ? new Date(json.updated_at).toISOString() : (json.updatedAt?.toISOString?.() || null),
  };
}

async function emitScheduleAuditAndEvent({
  tenantId,
  action,
  actor = {},
  schedule = null,
  details = {},
  eventType,
  idempotencyKey = null,
}) {
  const actorId = actor?.agentId || actor?.id || actor?.username || 'system';
  const actorType = actor?.actorType || (actor?.agentId || actor?.id ? 'user' : 'system');

  logAction({
    agentId: actor?.agentId || actor?.id || null,
    username: actor?.username || null,
    tenantId,
    action,
    resource: 'schedule',
    resourceId: schedule?.id || details?.scheduleId || null,
    details,
    ipAddress: actor?.ipAddress || 'unknown',
    userAgent: actor?.userAgent || 'unknown',
  });

  try {
    await appendEventV1({
      tenantId,
      type: eventType,
      source: 'scheduling.service',
      occurredAt: new Date().toISOString(),
      correlationId: schedule?.id || details?.scheduleId || null,
      subject: { type: 'schedule', id: schedule?.id || details?.scheduleId || null },
      actor: { type: actorType, id: actorId },
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      payload: details,
    });
  } catch (err) {
    logger.warn('[Scheduling] Falha ao registrar event_ledger (best-effort)', { action, error: err.message });
  }
}

async function maybeSyncBeautyLoyalty({ tenantId, schedule }) {
  const metadata = schedule?.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
  if (String(metadata.verticalTemplate || '').toLowerCase() !== 'beauty') return;
  if (!schedule?.contactId) return;
  try {
    const beautyService = require('./beautyService');
    if (typeof beautyService.reconcileLoyaltyForContact === 'function') {
      await beautyService.reconcileLoyaltyForContact({
        tenantId,
        contactId: String(schedule.contactId),
      });
    }
  } catch (err) {
    logger.warn('[Scheduling] Falha ao reconciliar fidelidade Beauty', {
      tenantId,
      scheduleId: schedule?.id || null,
      error: err?.message || String(err || 'unknown_error'),
    });
  }
}

function normalizeReminderRules(reminders = []) {
  if (!Array.isArray(reminders)) return [];
  const rows = [];
  for (const item of reminders) {
    if (!item || typeof item !== 'object') continue;
    const offsetMinutes = Number(item.offsetMinutes);
    const action = String(item.action || '').trim().toLowerCase();
    if (!Number.isFinite(offsetMinutes)) continue;
    if (!REMINDER_ACTIONS.has(action)) continue;
    const channelRaw = item.channel ? String(item.channel).trim().toLowerCase() : '';
    const channel = channelRaw && CHANNELS.has(channelRaw) ? channelRaw : null;
    rows.push({
      offsetMinutes: Math.trunc(offsetMinutes),
      action,
      channel,
      payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
    });
  }
  return rows;
}

function buildDefaultReminderRules({ requiresConfirmation }) {
  const enableNoShow = String(process.env.SCHEDULE_DEFAULT_ENABLE_NO_SHOW || 'true').toLowerCase() === 'true';
  const rules = [];
  if (requiresConfirmation) {
    rules.push({ offsetMinutes: -24 * 60, action: 'request_confirmation', channel: null, payload: {} });
    rules.push({ offsetMinutes: -60, action: 'notify', channel: null, payload: {} });
    if (enableNoShow) {
      rules.push({ offsetMinutes: 10, action: 'mark_no_show', channel: null, payload: {} });
    }
    return rules;
  }

  rules.push({ offsetMinutes: -60, action: 'notify', channel: null, payload: {} });
  if (enableNoShow) {
    rules.push({ offsetMinutes: 10, action: 'mark_no_show', channel: null, payload: {} });
  }
  return rules;
}

async function rebuildReminders({ tenantId, schedule, reminders = [], transaction = null }) {
  const ReminderModel = ScheduleReminder();
  await ReminderModel.destroy({
    where: { tenant_key: String(tenantId), schedule_id: String(schedule.id) },
    transaction,
  });

  const normalized = normalizeReminderRules(reminders);
  if (normalized.length === 0) return [];

  const startTs = new Date(schedule.start_at || schedule.startAt || schedule.start_at).getTime();
  const rows = normalized.map((r) => ({
    id: newId('srem'),
    tenant_key: String(tenantId),
    schedule_id: String(schedule.id),
    offset_minutes: r.offsetMinutes,
    action: r.action,
    channel: r.channel,
    execute_at: new Date(startTs + (r.offsetMinutes * 60 * 1000)),
    status: 'pending',
    payload: r.payload || {},
    last_error: null,
    executed_at: null,
  }));

  if (rows.length > 0) {
    await ReminderModel.bulkCreate(rows, { transaction });
  }
  return rows;
}

async function getAvailability({
  tenantId,
  mode = 'free',
  startAt,
  endAt,
  ownerId = null,
  teamId = null,
  timezone = 'UTC',
  excludeScheduleId = null,
}) {
  return resolveCentralAvailability({
    tenantId,
    mode: normalizeEnum(mode, MODES, 'mode', 'free'),
    startAt,
    endAt,
    ownerId,
    teamId,
    timezone: normalizeTimeZone(timezone),
    excludeOperationalScheduleId: excludeScheduleId,
  });
}

async function createSchedule({
  tenantId,
  input,
  actor = {},
}) {
  const ScheduleModel = OperationalSchedule();
  const sequelize = ScheduleModel.sequelize;
  const data = input && typeof input === 'object' ? input : {};

  const contextType = normalizeEnum(data.contextType, CONTEXT_TYPES, 'context_type');
  const channel = normalizeEnum(data.channel, CHANNELS, 'channel');
  const mode = normalizeEnum(data.mode || 'free', MODES, 'mode', 'free');
  const origin = normalizeEnum(data.origin || 'human', ORIGINS, 'origin', 'human');
  const timezone = normalizeTimeZone(data.timezone || 'UTC');
  const startAt = parseDateRequired(data.startAt, 'start_at');
  const endAt = parseDateRequired(data.endAt, 'end_at');
  if (endAt.getTime() <= startAt.getTime()) {
    const err = new Error('invalid_time_range');
    err.code = 'invalid_time_range';
    throw err;
  }

  const requiresConfirmation = !!data.requiresConfirmation;
  const confirmationStatus = requiresConfirmation ? 'pending' : 'not_required';
  const initialStatus = data.status
    ? normalizeEnum(data.status, new Set(['draft', 'scheduled']), 'status')
    : 'scheduled';
  const contextId = sanitizeString(data.contextId, 128);
  if (!contextId) {
    const err = new Error('context_id_required');
    err.code = 'context_id_required';
    throw err;
  }
  const requestUser = actor?.requestUser || null;
  const ownerId = normalizeReferenceId(data.ownerId, 'owner');
  const teamId = normalizeReferenceId(data.teamId, 'team');

  if (mode === 'team_based' && !ownerId && !teamId) {
    const err = new Error('team_or_owner_required');
    err.code = 'team_or_owner_required';
    throw err;
  }

  let owner = null;
  let team = null;
  if (ownerId) {
    owner = await getUserById(tenantId, ownerId);
    if (!owner) {
      const err = new Error('owner_not_found');
      err.code = 'owner_not_found';
      throw err;
    }
  }
  if (teamId) {
    team = await getTeamById(tenantId, teamId);
    if (!team) {
      const err = new Error('team_not_found');
      err.code = 'team_not_found';
      throw err;
    }
  }

  if (origin === 'bot' && ownerId) {
    const err = new Error('owner_not_allowed_for_bot');
    err.code = 'owner_not_allowed_for_bot';
    throw err;
  }
  if (origin === 'human' && requestUser) {
    if (ownerId && !canAssignOwner(requestUser, owner)) {
      const err = new Error('owner_not_allowed');
      err.code = 'owner_not_allowed';
      throw err;
    }
    if (teamId && !canAssignTeam(requestUser, team)) {
      const err = new Error('team_not_allowed');
      err.code = 'team_not_allowed';
      throw err;
    }
  }

  const idempotencyKey = data.idempotencyKey ? sanitizeString(data.idempotencyKey, 160) : null;
  const inputMetadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const incomingReminders = normalizeReminderRules(data.reminders || inputMetadata.reminders || []);
  const reminders = incomingReminders.length > 0
    ? incomingReminders
    : buildDefaultReminderRules({ requiresConfirmation });
  const metadataWithReminders = {
    ...inputMetadata,
    reminders,
  };

  if (mode === 'team_based') {
    const availability = await getAvailability({
      tenantId,
      mode,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      ownerId: ownerId || null,
      teamId: teamId || null,
      timezone,
    });
    if (!availability.available) {
      const err = new Error('schedule_unavailable');
      err.code = 'schedule_unavailable';
      err.details = availability;
      throw err;
    }
  }

  const created = await sequelize.transaction(async (tx) => {
    const row = await ScheduleModel.create({
      id: newId('schop'),
      tenant_key: String(tenantId),
      context_type: contextType,
      context_id: contextId,
      contact_id: data.contactId ? sanitizeString(data.contactId, 128) : null,
      conversation_id: data.conversationId ? sanitizeString(data.conversationId, 128) : null,
      channel,
      mode,
      origin,
      start_at: startAt,
      end_at: endAt,
      timezone,
      requires_confirmation: requiresConfirmation,
      confirmation_status: confirmationStatus,
      status: initialStatus,
      owner_id: ownerId ? sanitizeString(ownerId, 128) : null,
      team_id: teamId ? sanitizeString(teamId, 128) : null,
      purpose: sanitizeString(data.purpose || 'compromisso', 120, 'compromisso'),
      notes: data.notes ? String(data.notes).slice(0, 4000) : null,
      metadata: metadataWithReminders,
      idempotency_key: idempotencyKey,
    }, { transaction: tx }).catch(async (err) => {
      const isUnique = err?.name === 'SequelizeUniqueConstraintError';
      if (idempotencyKey && isUnique) {
        const existing = await ScheduleModel.findOne({
          where: { tenant_key: String(tenantId), idempotency_key: idempotencyKey },
          order: [['created_at', 'DESC']],
          transaction: tx,
        });
        if (existing) return existing;
      }
      throw err;
    });

    await rebuildReminders({
      tenantId,
      schedule: row,
      reminders,
      transaction: tx,
    });

    return row;
  });

  const mapped = mapScheduleRow(created);
  await emitScheduleAuditAndEvent({
    tenantId,
    action: 'schedule_create',
    actor,
    schedule: mapped,
    eventType: 'ScheduleCreated',
    idempotencyKey: idempotencyKey ? `schedule_create:${idempotencyKey}` : null,
    details: {
      scheduleId: mapped.id,
      contextType: mapped.contextType,
      contextId: mapped.contextId,
      channel: mapped.channel,
      mode: mapped.mode,
      requiresConfirmation: mapped.requiresConfirmation,
      status: mapped.status,
    },
  });
  await maybeSyncBeautyLoyalty({ tenantId, schedule: mapped });

  return { ok: true, schedule: mapped };
}

async function getScheduleById({ tenantId, scheduleId }) {
  const Model = OperationalSchedule();
  return Model.findOne({
    where: { tenant_key: String(tenantId), id: String(scheduleId) },
  });
}

async function updateScheduleState({
  tenantId,
  scheduleId,
  actor = {},
  action,
  eventType,
  allowedCurrentStatus = null,
  patch = {},
  details = {},
  idempotencyKey = null,
}) {
  const Model = OperationalSchedule();
  const row = await getScheduleById({ tenantId, scheduleId });
  if (!row) {
    const err = new Error('schedule_not_found');
    err.code = 'schedule_not_found';
    throw err;
  }

  if (Array.isArray(allowedCurrentStatus) && allowedCurrentStatus.length > 0) {
    const current = String(row.status || '').toLowerCase();
    if (!allowedCurrentStatus.includes(current)) {
      const err = new Error('invalid_schedule_transition');
      err.code = 'invalid_schedule_transition';
      err.details = { from: current, allowed: allowedCurrentStatus };
      throw err;
    }
  }

  await row.update({
    ...patch,
    updated_at: new Date(),
  });

  const mapped = mapScheduleRow(row);
  await emitScheduleAuditAndEvent({
    tenantId,
    action,
    actor,
    schedule: mapped,
    eventType,
    idempotencyKey,
    details: {
      scheduleId: mapped.id,
      status: mapped.status,
      confirmationStatus: mapped.confirmationStatus,
      ...details,
    },
  });
  await maybeSyncBeautyLoyalty({ tenantId, schedule: mapped });

  return { ok: true, schedule: mapped };
}

async function confirmSchedule({ tenantId, scheduleId, actor = {}, by = 'ui', idempotencyKey = null }) {
  const row = await getScheduleById({ tenantId, scheduleId });
  if (!row) {
    const err = new Error('schedule_not_found');
    err.code = 'schedule_not_found';
    throw err;
  }
  if (!row.requires_confirmation) {
    return updateScheduleState({
      tenantId,
      scheduleId,
      actor,
      action: 'schedule_confirm',
      eventType: 'ScheduleConfirmationSkipped',
      patch: { confirmation_status: 'not_required' },
      details: { reason: 'not_required', by },
      idempotencyKey: idempotencyKey ? `schedule_confirm:${idempotencyKey}` : null,
    });
  }

  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_confirm',
    eventType: 'ScheduleConfirmed',
    allowedCurrentStatus: ['draft', 'scheduled', 'in_progress'],
    patch: {
      confirmation_status: 'confirmed',
      status: String(row.status || '').toLowerCase() === 'draft' ? 'scheduled' : row.status,
    },
    details: { by },
    idempotencyKey: idempotencyKey ? `schedule_confirm:${idempotencyKey}` : null,
  });
}

async function declineSchedule({ tenantId, scheduleId, actor = {}, by = 'ui', idempotencyKey = null }) {
  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_decline',
    eventType: 'ScheduleDeclined',
    allowedCurrentStatus: ['draft', 'scheduled', 'in_progress'],
    patch: {
      confirmation_status: 'declined',
      status: 'canceled',
    },
    details: { by },
    idempotencyKey: idempotencyKey ? `schedule_decline:${idempotencyKey}` : null,
  });
}

async function rescheduleSchedule({
  tenantId,
  scheduleId,
  input,
  actor = {},
  idempotencyKey = null,
}) {
  const Model = OperationalSchedule();
  const row = await getScheduleById({ tenantId, scheduleId });
  if (!row) {
    const err = new Error('schedule_not_found');
    err.code = 'schedule_not_found';
    throw err;
  }
  if (['done', 'no_show', 'canceled'].includes(String(row.status || '').toLowerCase())) {
    const err = new Error('invalid_schedule_transition');
    err.code = 'invalid_schedule_transition';
    err.details = { from: row.status };
    throw err;
  }

  const nextStartAt = parseDateRequired(input?.startAt, 'start_at');
  const nextEndAt = parseDateRequired(input?.endAt, 'end_at');
  if (nextEndAt.getTime() <= nextStartAt.getTime()) {
    const err = new Error('invalid_time_range');
    err.code = 'invalid_time_range';
    throw err;
  }

  const nextTimezone = normalizeTimeZone(input?.timezone || row.timezone || 'UTC');
  const nextMode = normalizeEnum(input?.mode || row.mode || 'free', MODES, 'mode', 'free');
  const nextOwnerId = input?.ownerId !== undefined ? (input.ownerId ? String(input.ownerId) : null) : row.owner_id;
  const nextTeamId = input?.teamId !== undefined ? (input.teamId ? String(input.teamId) : null) : row.team_id;
  const nextChannel = normalizeEnum(input?.channel || row.channel, CHANNELS, 'channel');
  const nextPurpose = sanitizeString(input?.purpose || row.purpose || 'compromisso', 120, 'compromisso');
  const nextNotes = input?.notes !== undefined ? String(input.notes || '').slice(0, 4000) : row.notes;
  const nextOrigin = normalizeEnum(input?.origin || row.origin || 'human', ORIGINS, 'origin', 'human');

  if (nextMode === 'team_based') {
    const availability = await getAvailability({
      tenantId,
      mode: nextMode,
      startAt: nextStartAt.toISOString(),
      endAt: nextEndAt.toISOString(),
      ownerId: nextOwnerId || null,
      teamId: nextTeamId || null,
      timezone: nextTimezone,
      excludeScheduleId: row.id,
    });
    if (!availability.available) {
      const err = new Error('schedule_unavailable');
      err.code = 'schedule_unavailable';
      err.details = availability;
      throw err;
    }
  }

  const incomingReminders = normalizeReminderRules(
    input?.reminders
    || input?.metadata?.reminders
    || row.metadata?.reminders
    || []
  );
  const reminders = incomingReminders.length > 0
    ? incomingReminders
    : buildDefaultReminderRules({ requiresConfirmation: !!row.requires_confirmation });

  const updated = await Model.sequelize.transaction(async (tx) => {
    await row.update({
      start_at: nextStartAt,
      end_at: nextEndAt,
      timezone: nextTimezone,
      mode: nextMode,
      owner_id: nextOwnerId,
      team_id: nextTeamId,
      channel: nextChannel,
      purpose: nextPurpose,
      notes: nextNotes,
      origin: nextOrigin,
      metadata: {
        ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
        ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
        reminders,
      },
      status: ['draft', 'scheduled', 'in_progress'].includes(String(row.status || '').toLowerCase())
        ? 'scheduled'
        : row.status,
      updated_at: new Date(),
    }, { transaction: tx });

    await rebuildReminders({
      tenantId,
      schedule: row,
      reminders,
      transaction: tx,
    });

    return row;
  });

  return updateScheduleState({
    tenantId,
    scheduleId: updated.id,
    actor,
    action: 'schedule_reschedule',
    eventType: 'ScheduleRescheduled',
    patch: {},
    details: {
      startAt: new Date(updated.start_at).toISOString(),
      endAt: new Date(updated.end_at).toISOString(),
    },
    idempotencyKey: idempotencyKey ? `schedule_reschedule:${idempotencyKey}` : null,
  });
}

async function cancelSchedule({ tenantId, scheduleId, actor = {}, reason = null, idempotencyKey = null }) {
  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_cancel',
    eventType: 'ScheduleCanceled',
    allowedCurrentStatus: ['draft', 'scheduled', 'in_progress'],
    patch: { status: 'canceled' },
    details: { reason: reason ? String(reason).slice(0, 300) : null },
    idempotencyKey: idempotencyKey ? `schedule_cancel:${idempotencyKey}` : null,
  });
}

async function markInProgress({ tenantId, scheduleId, actor = {}, idempotencyKey = null }) {
  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_in_progress',
    eventType: 'ScheduleInProgress',
    allowedCurrentStatus: ['scheduled'],
    patch: { status: 'in_progress' },
    idempotencyKey: idempotencyKey ? `schedule_in_progress:${idempotencyKey}` : null,
  });
}

async function markDone({ tenantId, scheduleId, actor = {}, idempotencyKey = null }) {
  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_done',
    eventType: 'ScheduleDone',
    allowedCurrentStatus: ['scheduled', 'in_progress'],
    patch: { status: 'done' },
    idempotencyKey: idempotencyKey ? `schedule_done:${idempotencyKey}` : null,
  });
}

async function markNoShow({ tenantId, scheduleId, actor = {}, idempotencyKey = null }) {
  return updateScheduleState({
    tenantId,
    scheduleId,
    actor,
    action: 'schedule_no_show',
    eventType: 'ScheduleNoShow',
    allowedCurrentStatus: ['scheduled', 'in_progress'],
    patch: { status: 'no_show' },
    idempotencyKey: idempotencyKey ? `schedule_no_show:${idempotencyKey}` : null,
  });
}

async function listSchedules({
  tenantId,
  filters = {},
}) {
  const Model = OperationalSchedule();
  const where = { tenant_key: String(tenantId) };

  if (filters.contextType) where.context_type = normalizeEnum(filters.contextType, CONTEXT_TYPES, 'context_type');
  if (filters.contextId) where.context_id = String(filters.contextId);
  if (filters.contactId) where.contact_id = String(filters.contactId);
  if (filters.conversationId) where.conversation_id = String(filters.conversationId);
  if (filters.channel) where.channel = normalizeEnum(filters.channel, CHANNELS, 'channel');
  if (filters.mode) where.mode = normalizeEnum(filters.mode, MODES, 'mode');
  if (filters.status) where.status = normalizeEnum(filters.status, SCHEDULE_STATUSES, 'status');
  if (filters.confirmationStatus) where.confirmation_status = normalizeEnum(filters.confirmationStatus, CONFIRMATION_STATUSES, 'confirmation_status');
  if (filters.ownerId) where.owner_id = String(filters.ownerId);
  if (filters.teamId) where.team_id = String(filters.teamId);
  if (filters.purpose) {
    const needle = String(filters.purpose).trim().toLowerCase();
    if (needle) {
      where[Op.and] = [
        sqlWhere(fn('LOWER', col('purpose')), { [Op.like]: `%${needle}%` }),
      ];
    }
  }

  const startFrom = filters.startFrom ? parseDateRequired(filters.startFrom, 'start_from') : null;
  const startTo = filters.startTo ? parseDateRequired(filters.startTo, 'start_to') : null;
  if (startFrom || startTo) {
    where.start_at = {};
    if (startFrom) where.start_at[Op.gte] = startFrom;
    if (startTo) where.start_at[Op.lte] = startTo;
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['start_at', 'ASC'], ['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    ok: true,
    total: count,
    items: (rows || []).map(mapScheduleRow),
    limit,
    offset,
  };
}

async function upsertWorkingHours({
  tenantId,
  scopeType,
  scopeId,
  timezone = 'UTC',
  items = [],
  actor = {},
}) {
  const normalizedScopeType = normalizeEnum(scopeType, SCOPE_TYPES, 'scope_type');
  const normalizedScopeId = sanitizeString(scopeId, 128);
  if (!normalizedScopeId) {
    const err = new Error('scope_id_required');
    err.code = 'scope_id_required';
    throw err;
  }
  const Model = ScheduleWorkingHour();
  const sequelize = Model.sequelize;
  const normalizedRows = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item || typeof item !== 'object') continue;
    const weekday = Number(item.weekday);
    const startTime = sanitizeString(item.startTime, 5);
    const endTime = sanitizeString(item.endTime, 5);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (minutesFromTime(startTime) === null || minutesFromTime(endTime) === null) continue;
    if (minutesFromTime(endTime) <= minutesFromTime(startTime)) continue;
    normalizedRows.push({
      id: newId('swh'),
      tenant_key: String(tenantId),
      scope_type: normalizedScopeType,
      scope_id: normalizedScopeId,
      weekday,
      start_time: startTime,
      end_time: endTime,
      timezone: normalizeTimeZone(item.timezone || timezone),
      enabled: item.enabled !== false,
      metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    });
  }

  await sequelize.transaction(async (tx) => {
    await Model.destroy({
      where: {
        tenant_key: String(tenantId),
        scope_type: normalizedScopeType,
        scope_id: normalizedScopeId,
      },
      transaction: tx,
    });
    if (normalizedRows.length > 0) {
      await Model.bulkCreate(normalizedRows, { transaction: tx });
    }
  });

  await emitScheduleAuditAndEvent({
    tenantId,
    action: 'schedule_working_hours_upsert',
    actor,
    details: {
      scopeType: normalizedScopeType,
      scopeId: normalizedScopeId,
      rows: normalizedRows.length,
    },
    eventType: 'ScheduleWorkingHoursUpdated',
    idempotencyKey: `schedule_working_hours:${tenantId}:${normalizedScopeType}:${normalizedScopeId}`,
  });

  return listWorkingHours({ tenantId, scopeType: normalizedScopeType, scopeId: normalizedScopeId });
}

async function listWorkingHours({
  tenantId,
  scopeType = null,
  scopeId = null,
}) {
  const Model = ScheduleWorkingHour();
  const where = { tenant_key: String(tenantId) };
  if (scopeType) where.scope_type = normalizeEnum(scopeType, SCOPE_TYPES, 'scope_type');
  if (scopeId) where.scope_id = String(scopeId);

  const rows = await Model.findAll({
    where,
    order: [['scope_type', 'ASC'], ['scope_id', 'ASC'], ['weekday', 'ASC'], ['start_time', 'ASC']],
    limit: 2000,
  });

  return {
    ok: true,
    items: (rows || []).map(mapWorkingHourRow),
  };
}

async function createBlock({
  tenantId,
  scopeType,
  scopeId,
  startAt,
  endAt,
  reason = null,
  metadata = {},
  actor = {},
}) {
  const Model = ScheduleBlock();
  const normalizedScopeType = normalizeEnum(scopeType, SCOPE_TYPES, 'scope_type');
  const normalizedScopeId = sanitizeString(scopeId, 128);
  const start = parseDateRequired(startAt, 'start_at');
  const end = parseDateRequired(endAt, 'end_at');
  if (end.getTime() <= start.getTime()) {
    const err = new Error('invalid_time_range');
    err.code = 'invalid_time_range';
    throw err;
  }

  const row = await Model.create({
    id: newId('sblk'),
    tenant_key: String(tenantId),
    scope_type: normalizedScopeType,
    scope_id: normalizedScopeId,
    start_at: start,
    end_at: end,
    reason: reason ? String(reason).slice(0, 160) : null,
    active: true,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  await emitScheduleAuditAndEvent({
    tenantId,
    action: 'schedule_block_create',
    actor,
    details: {
      scheduleBlockId: row.id,
      scopeType: normalizedScopeType,
      scopeId: normalizedScopeId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      reason: row.reason || null,
    },
    eventType: 'ScheduleBlockCreated',
    idempotencyKey: `schedule_block_create:${tenantId}:${row.id}`,
  });

  return { ok: true, block: mapBlockRow(row) };
}

async function listBlocks({
  tenantId,
  scopeType = null,
  scopeId = null,
  active = null,
  startFrom = null,
  startTo = null,
}) {
  const Model = ScheduleBlock();
  const where = { tenant_key: String(tenantId) };
  if (scopeType) where.scope_type = normalizeEnum(scopeType, SCOPE_TYPES, 'scope_type');
  if (scopeId) where.scope_id = String(scopeId);
  if (active !== null && active !== undefined) where.active = !!active;
  if (startFrom || startTo) {
    where.start_at = {};
    if (startFrom) where.start_at[Op.gte] = parseDateRequired(startFrom, 'start_from');
    if (startTo) where.start_at[Op.lte] = parseDateRequired(startTo, 'start_to');
  }

  const rows = await Model.findAll({
    where,
    order: [['start_at', 'ASC']],
    limit: 2000,
  });

  return {
    ok: true,
    items: (rows || []).map(mapBlockRow),
  };
}

async function deactivateBlock({
  tenantId,
  blockId,
  actor = {},
}) {
  const Model = ScheduleBlock();
  const row = await Model.findOne({
    where: { tenant_key: String(tenantId), id: String(blockId) },
  });
  if (!row) {
    const err = new Error('schedule_block_not_found');
    err.code = 'schedule_block_not_found';
    throw err;
  }
  await row.update({ active: false, updated_at: new Date() });
  await emitScheduleAuditAndEvent({
    tenantId,
    action: 'schedule_block_deactivate',
    actor,
    details: { scheduleBlockId: row.id },
    eventType: 'ScheduleBlockDeactivated',
    idempotencyKey: `schedule_block_deactivate:${tenantId}:${row.id}`,
  });
  return { ok: true, block: mapBlockRow(row) };
}

async function listReminders({
  tenantId,
  scheduleId = null,
  status = null,
  limit = 200,
  offset = 0,
}) {
  const Model = ScheduleReminder();
  const where = { tenant_key: String(tenantId) };
  if (scheduleId) where.schedule_id = String(scheduleId);
  if (status) where.status = normalizeEnum(status, REMINDER_STATUSES, 'reminder_status');
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['execute_at', 'ASC']],
    limit: safeLimit,
    offset: safeOffset,
  });
  return {
    ok: true,
    total: count,
    items: (rows || []).map((r) => {
      const json = r.toJSON ? r.toJSON() : r;
      return {
        id: json.id,
        tenantId: json.tenant_key,
        scheduleId: json.schedule_id,
        offsetMinutes: json.offset_minutes,
        action: json.action,
        channel: json.channel || null,
        executeAt: json.execute_at ? new Date(json.execute_at).toISOString() : null,
        status: json.status,
        payload: json.payload || {},
        lastError: json.last_error || null,
        executedAt: json.executed_at ? new Date(json.executed_at).toISOString() : null,
      };
    }),
    limit: safeLimit,
    offset: safeOffset,
  };
}

module.exports = {
  CONTEXT_TYPES,
  CHANNELS,
  MODES,
  ORIGINS,
  CONFIRMATION_STATUSES,
  SCHEDULE_STATUSES,
  REMINDER_ACTIONS,
  createSchedule,
  confirmSchedule,
  declineSchedule,
  rescheduleSchedule,
  cancelSchedule,
  markInProgress,
  markDone,
  markNoShow,
  listSchedules,
  getAvailability,
  upsertWorkingHours,
  listWorkingHours,
  createBlock,
  listBlocks,
  deactivateBlock,
  listReminders,
};

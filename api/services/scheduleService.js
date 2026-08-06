// ── defensive helpers ────────────────────────────────────────────────────────
const { emitEvent } = require('./websocketService');
const logger = require('../utils/logger');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeGet(obj, key, fallback = undefined) {
  if (obj == null) return fallback;
  try { const v = obj[key]; return v === undefined ? fallback : v; } catch (_) { return fallback; }
}

function safeSafeArray(value) {
  if (!Array.isArray(value)) return [];
  try { return [...value]; } catch (_) { return []; }
}
// ─────────────────────────────────────────────────────────────────────────────

// Notifica páginas operacionais (agenda Beauty, Painel Vertical) via WebSocket.
// Best-effort: falha no emit nunca bloqueia o write do agendamento.
function emitScheduleUpdated({ tenantId, scheduleId, action, schedule = null }) {
  const safeTenantId = safeToString(tenantId, '') || '';
  if (!safeTenantId) return;
  try {
    emitEvent('vertical.schedule.updated', {
      tenantId: safeTenantId,
      entityId: scheduleId,
      action,
      contextType: schedule ? schedule.contextType : null,
      vertical: schedule && schedule.metadata && typeof schedule.metadata === 'object' ? (schedule.metadata.vertical || null) : null,
    }, { tenantId: safeTenantId });
  } catch (err) {
    logger.warn('[ScheduleService] Falha ao emitir vertical.schedule.updated', { action, scheduleId });
  }
}

const schedulesByTenant = new Map();

function genScheduleId() {
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTenantStore(tenantId) {
  const key = safeToString(tenantId, 'default') || 'default';
  if (!schedulesByTenant.has(key)) schedulesByTenant.set(key, new Map());
  return schedulesByTenant.get(key);
}

function listSchedules({ tenantId, contextType, contextId, limit = 50 } = {}) {
  let items = Array.from(getTenantStore(tenantId).values());
  if (contextType) items = items.filter((item) => item.contextType === contextType);
  if (contextId) items = items.filter((item) => item.contextId === contextId);
  items.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const cappedLimit = Math.min(Number(limit) || 50, 200);
  return {
    items: items.slice(0, cappedLimit),
    total: items.length,
  };
}

function createSchedule({ tenantId, payload }) {
  const now = new Date().toISOString();
  const id = genScheduleId();
  const schedule = {
    id,
    tenantId: safeToString(tenantId, 'default') || 'default',
    contextType: safeToString(safeGet(payload, 'contextType'), 'custom') || 'custom',
    contextId: safeToString(safeGet(payload, 'contextId'), ''),
    contactId: safeGet(payload, 'contactId', null),
    conversationId: safeGet(payload, 'conversationId', null),
    channel: safeGet(payload, 'channel', 'whatsapp'),
    mode: safeGet(payload, 'mode', 'agent_based'),
    startAt: safeGet(payload, 'startAt', now),
    endAt: safeGet(payload, 'endAt', now),
    timezone: safeGet(payload, 'timezone', 'UTC'),
    purpose: safeGet(payload, 'purpose', 'compromisso'),
    notes: safeGet(payload, 'notes', null),
    origin: safeGet(payload, 'origin', 'human'),
    status: 'scheduled',
    confirmationStatus: safeGet(payload, 'requiresConfirmation') ? 'pending' : 'not_required',
    requiresConfirmation: !!safeGet(payload, 'requiresConfirmation'),
    ownerId: safeGet(payload, 'ownerId', null),
    teamId: safeGet(payload, 'teamId', null),
    reminders: safeSafeArray(safeGet(payload, 'reminders')),
    metadata: safeGet(payload, 'metadata', {}),
    createdAt: now,
    updatedAt: now,
  };
  getTenantStore(tenantId).set(id, schedule);
  emitScheduleUpdated({ tenantId, scheduleId: id, action: 'created', schedule });
  return schedule;
}

function getSchedule({ tenantId, scheduleId }) {
  return getTenantStore(tenantId).get(safeToString(scheduleId)) || null;
}

function deleteSchedule({ tenantId, scheduleId }) {
  const store = getTenantStore(tenantId);
  const deleted = store.delete(safeToString(scheduleId));
  if (deleted) {
    emitScheduleUpdated({ tenantId, scheduleId: safeToString(scheduleId), action: 'deleted' });
  }
  return deleted;
}

function updateScheduleStatus({ tenantId, scheduleId, action, payload = {} }) {
  const schedule = getSchedule({ tenantId, scheduleId });
  if (!schedule) {
    const err = new Error('schedule_not_found');
    err.code = 'schedule_not_found';
    throw err;
  }

  const now = new Date().toISOString();
  if (action === 'confirm') {
    schedule.confirmationStatus = 'confirmed';
    schedule.status = 'scheduled';
  } else if (action === 'decline') {
    schedule.confirmationStatus = 'declined';
    schedule.status = 'cancelled';
  } else if (action === 'cancel') {
    schedule.status = 'cancelled';
  } else if (action === 'done') {
    schedule.status = 'done';
  } else if (action === 'no-show') {
    schedule.status = 'no_show';
  } else if (action === 'in-progress') {
    schedule.status = 'in_progress';
  } else if (action === 'reschedule') {
    if (payload.startAt) schedule.startAt = payload.startAt;
    if (payload.endAt) schedule.endAt = payload.endAt;
    schedule.status = 'scheduled';
  } else {
    const err = new Error('schedule_action_not_found');
    err.code = 'schedule_action_not_found';
    throw err;
  }

  schedule.updatedAt = now;
  getTenantStore(tenantId).set(safeToString(scheduleId), schedule);
  emitScheduleUpdated({ tenantId, scheduleId: safeToString(scheduleId), action, schedule });
  return schedule;
}

module.exports = {
  listSchedules,
  createSchedule,
  getSchedule,
  deleteSchedule,
  updateScheduleStatus,
  _getTenantStore: getTenantStore,
};

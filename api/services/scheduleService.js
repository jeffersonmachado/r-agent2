const schedulesByTenant = new Map();

function genScheduleId() {
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTenantStore(tenantId) {
  const key = String(tenantId || 'default');
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
    tenantId: String(tenantId || 'default'),
    contextType: String(payload?.contextType || 'custom'),
    contextId: String(payload?.contextId || ''),
    contactId: payload?.contactId || null,
    conversationId: payload?.conversationId || null,
    channel: payload?.channel || 'whatsapp',
    mode: payload?.mode || 'agent_based',
    startAt: payload?.startAt || now,
    endAt: payload?.endAt || now,
    timezone: payload?.timezone || 'UTC',
    purpose: payload?.purpose || 'compromisso',
    notes: payload?.notes || null,
    origin: payload?.origin || 'human',
    status: 'scheduled',
    confirmationStatus: payload?.requiresConfirmation ? 'pending' : 'not_required',
    requiresConfirmation: !!payload?.requiresConfirmation,
    ownerId: payload?.ownerId || null,
    teamId: payload?.teamId || null,
    reminders: Array.isArray(payload?.reminders) ? payload.reminders : [],
    metadata: payload?.metadata || {},
    createdAt: now,
    updatedAt: now,
  };
  getTenantStore(tenantId).set(id, schedule);
  return schedule;
}

function getSchedule({ tenantId, scheduleId }) {
  return getTenantStore(tenantId).get(String(scheduleId)) || null;
}

function deleteSchedule({ tenantId, scheduleId }) {
  const store = getTenantStore(tenantId);
  return store.delete(String(scheduleId));
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
  getTenantStore(tenantId).set(String(scheduleId), schedule);
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

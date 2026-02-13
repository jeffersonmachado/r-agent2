/**
 * Tasks/Reminders (v1) - MVP.
 *
 * Armazena tarefas em tenant_settings.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'tasks';

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    tasks: Array.isArray(obj.tasks) ? obj.tasks : [],
  };
}

function normalizeTask(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    title: item.title ? String(item.title) : '',
    description: item.description ? String(item.description) : '',
    dueAt: item.dueAt || null,
    reminderAt: item.reminderAt || null,
    status: item.status ? String(item.status) : 'open',
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    completedAt: item.completedAt || null,
    priority: item.priority ? String(item.priority) : 'normal',
  };
}

async function getStore(tenantId) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function saveStore(tenantId, store) {
  const payload = normalizeStore(store);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: payload });
  if (!out.ok) return { ok: false, error: out.error || 'settings_unavailable' };
  return { ok: true, store: normalizeStore(out.value) };
}

async function listTasks(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const items = out.store.tasks.map(normalizeTask).filter(Boolean);
  return { ok: true, tasks: items };
}

async function createTask(tenantId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date().toISOString();
  const id = `task-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeTask({
    id,
    title: input?.title ? String(input.title).trim() : '',
    description: input?.description ? String(input.description).trim() : '',
    dueAt: input?.dueAt || null,
    status: 'open',
    priority: input?.priority ? String(input.priority) : 'normal',
    createdAt: now,
    updatedAt: now,
  });
  out.store.tasks.push(next);
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, task: next, tasks: saved.store.tasks.map(normalizeTask).filter(Boolean) };
}

async function completeTask(tenantId, taskId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.tasks.findIndex((t) => t && String(t.id) === String(taskId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const next = normalizeTask({
    ...out.store.tasks[idx],
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  });
  out.store.tasks[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, task: next };
}

async function scheduleReminder(tenantId, taskId, reminderAt) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.tasks.findIndex((t) => t && String(t.id) === String(taskId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const next = normalizeTask({
    ...out.store.tasks[idx],
    reminderAt: reminderAt || null,
    updatedAt: now,
  });
  out.store.tasks[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, task: next };
}

module.exports = {
  listTasks,
  createTask,
  completeTask,
  scheduleReminder,
};

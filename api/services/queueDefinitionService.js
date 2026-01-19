/**
 * Serviço de definição de filas (Queue definitions) - DB-only com cache.
 *
 * Mantém compatibilidade com o uso atual de "queueName" como string.
 * Este serviço adiciona metadados: priority, departmentId, routingStrategy.
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { Queue: QueueGetter } = require('../db/models');

/** @type {Map<string, any>} */
const queues = new Map(); // id -> QueueDefinition

function dbAvailable() {
  return !!getSequelize();
}

function newId() {
  return `queue-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    name: row.name,
    priority: Number.isFinite(row.priority) ? row.priority : 0,
    departmentId: row.department_id || null,
    routingStrategy: row.routing_strategy || 'manual',
    active: row.active !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || null),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || null),
  };
}

function toDbPayload(q) {
  return {
    id: q.id,
    tenant_key: q.tenantId,
    name: q.name,
    priority: Number.isFinite(q.priority) ? q.priority : 0,
    department_id: q.departmentId || null,
    routing_strategy: q.routingStrategy || 'manual',
    active: q.active !== false,
  };
}

async function initialize() {
  if (!dbAvailable()) return;
  try {
    const QueueModel = typeof QueueGetter === 'function' ? QueueGetter() : QueueGetter;
    const rows = await QueueModel.findAll();
    queues.clear();
    for (const row of rows) {
      const q = fromDbRow(row);
      queues.set(q.id, q);
    }
    logger.info('[QueueDefinitionService] Cache inicializado do PostgreSQL', { count: queues.size });
  } catch (err) {
    logger.warn('[QueueDefinitionService] Falha ao inicializar cache do PostgreSQL', { error: err.message });
  }
}

function listQueues(filters = {}) {
  let list = Array.from(queues.values());
  if (filters.tenantId) list = list.filter(q => q.tenantId === filters.tenantId);
  if (filters.activeOnly !== false) list = list.filter(q => q.active !== false);
  list.sort((a, b) => (b.priority - a.priority) || a.name.localeCompare(b.name));
  return list;
}

function getQueueById(id) {
  return queues.get(id) || null;
}

function getQueueByName(tenantId, name) {
  if (!tenantId || !name) return null;
  const needle = String(name).trim().toLowerCase();
  for (const q of queues.values()) {
    if (q.tenantId === tenantId && q.name.toLowerCase() === needle) return q;
  }
  return null;
}

async function upsertQueue(queueData) {
  if (!dbAvailable()) return { success: false, error: 'db_unavailable' };

  const QueueModel = typeof QueueGetter === 'function' ? QueueGetter() : QueueGetter;
  const now = new Date();

  const tenantId = queueData.tenantId;
  const name = String(queueData.name || '').trim();
  if (!tenantId || typeof tenantId !== 'string') return { success: false, error: 'tenantId é obrigatório' };
  if (!name) return { success: false, error: 'name é obrigatório' };

  const existing = await QueueModel.findOne({ where: { tenant_key: tenantId, name } });
  const id = existing ? existing.id : (queueData.id || newId());

  const queue = {
    id,
    tenantId,
    name,
    priority: Number.isFinite(queueData.priority) ? queueData.priority : 0,
    departmentId: queueData.departmentId || null,
    routingStrategy: queueData.routingStrategy || 'manual',
    active: queueData.active !== false,
    createdAt: existing ? undefined : now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const payload = toDbPayload(queue);

  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await QueueModel.create({ ...payload, created_at: now, updated_at: now });
  }

  queues.set(queue.id, { ...queue, createdAt: queue.createdAt || (existing?.created_at ? new Date(existing.created_at).toISOString() : null) });

  return { success: true, queue: queues.get(queue.id) };
}

module.exports = {
  initialize,
  listQueues,
  getQueueById,
  getQueueByName,
  upsertQueue,
};


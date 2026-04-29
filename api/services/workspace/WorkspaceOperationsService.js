'use strict';

const { Op } = require('sequelize');
const {
  Task,
  TimesheetEntry,
  Resource,
  ResourceAvailability,
  ResourceBooking,
  PaymentEvent,
} = require('../../db/models');
const WorkspaceEntityService = require('./WorkspaceEntityService');
const { safeString, toPlain, clampLimit, offsetValue } = require('./workspaceUtils');

function nullable(value) {
  const s = safeString(value).trim();
  return s || null;
}

function dateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

class WorkspaceOperationsService {
  constructor(deps = {}) {
    this.Task = deps.Task || Task;
    this.TimesheetEntry = deps.TimesheetEntry || TimesheetEntry;
    this.Resource = deps.Resource || Resource;
    this.ResourceAvailability = deps.ResourceAvailability || ResourceAvailability;
    this.ResourceBooking = deps.ResourceBooking || ResourceBooking;
    this.PaymentEvent = deps.PaymentEvent || PaymentEvent;
    this.entityService = deps.entityService || new WorkspaceEntityService(deps);
  }

  async createTask({ tenantId, payload = {} }) {
    const title = safeString(payload.title).trim();
    if (!title) throw new Error('task_title_required');
    const task = toPlain(await this.Task().create({
      tenant_id: tenantId,
      entity_id: nullable(payload.entityId || payload.entity_id),
      ticket_id: nullable(payload.ticketId || payload.ticket_id),
      project_id: nullable(payload.projectId || payload.project_id),
      conversation_id: nullable(payload.conversationId || payload.conversation_id),
      title,
      description: nullable(payload.description),
      type: safeString(payload.type || 'manual') || 'manual',
      priority: safeString(payload.priority || 'normal') || 'normal',
      status: safeString(payload.status || 'open') || 'open',
      due_date: dateOrNull(payload.dueDate || payload.due_date),
      assigned_to: nullable(payload.assignedTo || payload.assigned_to),
    }));
    if (task.entity_id) {
      await this.entityService.linkEntity({ tenantId, entityId: task.entity_id, sourceType: 'task', sourceId: task.id, confidence: 1 });
    }
    return task;
  }

  async listTasks({ tenantId, entityId = null, status = null, limit = 100, offset = 0 }) {
    const where = { tenant_id: tenantId };
    if (entityId) where.entity_id = entityId;
    if (status) where.status = status;
    const result = await this.Task().findAndCountAll({ where, order: [['created_at', 'DESC']], limit: clampLimit(limit, 100, 200), offset: offsetValue(offset) });
    return { items: result.rows.map(toPlain), total: result.count };
  }

  async createTimesheetEntry({ tenantId, payload = {}, userId = null }) {
    const duration = Number(payload.durationMinutes || payload.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('duration_minutes_required');
    return toPlain(await this.TimesheetEntry().create({
      tenant_id: tenantId,
      entity_id: nullable(payload.entityId || payload.entity_id),
      task_id: nullable(payload.taskId || payload.task_id),
      ticket_id: nullable(payload.ticketId || payload.ticket_id),
      project_id: nullable(payload.projectId || payload.project_id),
      user_id: nullable(payload.userId || payload.user_id || userId),
      duration_minutes: Math.trunc(duration),
      description: nullable(payload.description),
    }));
  }

  async listTimesheetEntries({ tenantId, query = {} }) {
    const where = { tenant_id: tenantId };
    if (query.entity_id || query.entityId) where.entity_id = query.entity_id || query.entityId;
    if (query.project_id || query.projectId) where.project_id = query.project_id || query.projectId;
    if (query.ticket_id || query.ticketId) where.ticket_id = query.ticket_id || query.ticketId;
    const rows = await this.TimesheetEntry().findAll({ where, order: [['created_at', 'DESC']], limit: clampLimit(query.limit, 100, 300), offset: offsetValue(query.offset) });
    return { items: rows.map(toPlain) };
  }

  async createResource({ tenantId, payload = {} }) {
    const name = safeString(payload.name).trim();
    const type = safeString(payload.type).trim();
    if (!name || !type) throw new Error('resource_name_type_required');
    return toPlain(await this.Resource().create({ tenant_id: tenantId, type, name, metadata: payload.metadata || {} }));
  }

  async listResources({ tenantId, query = {} }) {
    const where = { tenant_id: tenantId };
    if (query.type) where.type = query.type;
    const rows = await this.Resource().findAll({ where, order: [['name', 'ASC']], limit: clampLimit(query.limit, 100, 300), offset: offsetValue(query.offset) });
    return { items: rows.map(toPlain) };
  }

  async createResourceAvailability({ tenantId, payload = {} }) {
    if (!payload.resourceId && !payload.resource_id) throw new Error('resource_id_required');
    return toPlain(await this.ResourceAvailability().create({
      tenant_id: tenantId,
      resource_id: payload.resourceId || payload.resource_id,
      starts_at: dateOrNull(payload.startsAt || payload.starts_at),
      ends_at: dateOrNull(payload.endsAt || payload.ends_at),
      status: safeString(payload.status || 'available') || 'available',
      metadata: payload.metadata || {},
    }));
  }

  async createResourceBooking({ tenantId, payload = {} }) {
    if (!payload.resourceId && !payload.resource_id) throw new Error('resource_id_required');
    return toPlain(await this.ResourceBooking().create({
      tenant_id: tenantId,
      resource_id: payload.resourceId || payload.resource_id,
      entity_id: nullable(payload.entityId || payload.entity_id),
      task_id: nullable(payload.taskId || payload.task_id),
      starts_at: dateOrNull(payload.startsAt || payload.starts_at),
      ends_at: dateOrNull(payload.endsAt || payload.ends_at),
      status: safeString(payload.status || 'booked') || 'booked',
      metadata: payload.metadata || {},
    }));
  }

  async createPaymentEvent({ tenantId, payload = {} }) {
    const payment = toPlain(await this.PaymentEvent().create({
      tenant_id: tenantId,
      entity_id: nullable(payload.entityId || payload.entity_id),
      amount: Number(payload.amount) || 0,
      status: safeString(payload.status || 'pending') || 'pending',
      type: safeString(payload.type || 'payment') || 'payment',
      metadata: payload.metadata || {},
    }));
    if (payment.entity_id) {
      await this.entityService.linkEntity({ tenantId, entityId: payment.entity_id, sourceType: 'payment', sourceId: payment.id, confidence: 1 });
    }
    return payment;
  }

  async listPaymentEvents({ tenantId, query = {} }) {
    const where = { tenant_id: tenantId };
    if (query.entity_id || query.entityId) where.entity_id = query.entity_id || query.entityId;
    if (query.status) where.status = query.status;
    const rows = await this.PaymentEvent().findAll({ where, order: [['created_at', 'DESC']], limit: clampLimit(query.limit, 100, 300), offset: offsetValue(query.offset) });
    return { items: rows.map(toPlain) };
  }

  async listResourceBookings({ tenantId, query = {} }) {
    const where = { tenant_id: tenantId };
    if (query.entity_id || query.entityId) where.entity_id = query.entity_id || query.entityId;
    if (query.resource_id || query.resourceId) where.resource_id = query.resource_id || query.resourceId;
    if (query.from || query.to) {
      where.starts_at = {};
      if (query.from) where.starts_at[Op.gte] = new Date(query.from);
      if (query.to) where.starts_at[Op.lte] = new Date(query.to);
    }
    const rows = await this.ResourceBooking().findAll({ where, order: [['starts_at', 'ASC']], limit: clampLimit(query.limit, 100, 300), offset: offsetValue(query.offset) });
    return { items: rows.map(toPlain) };
  }
}

module.exports = WorkspaceOperationsService;

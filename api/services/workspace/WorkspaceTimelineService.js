'use strict';

const { Op } = require('sequelize');
const {
  WorkspaceEntity,
  WorkspaceEntityLink,
  WorkspaceTimelineEvent,
  Ticket,
  ChannelConversation,
  ChannelMessage,
  Schedule,
  Project,
  ProjectItem,
  RagDocument,
  Evidence,
  MarketingLead,
  Task,
  PaymentEvent,
  Tenant,
} = require('../../db/models');
const logger = require('../../utils/logger');
const { safeString, toPlain, toDate, clampLimit, offsetValue, uniqBy } = require('./workspaceUtils');
const { sanitizeTimelineEvents } = require('./timelineSanitization');

const SOURCE_TO_TIMELINE_TYPE = {
  conversation: 'conversation',
  message: 'message',
  ticket: 'ticket',
  task: 'task',
  schedule: 'schedule',
  project: 'project',
  project_item: 'project',
  document: 'document',
  evidence: 'evidence',
  lead: 'lead',
  payment: 'payment',
};

function firstText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return safeString(value.text || value.body || value.caption || value.content || value.message || JSON.stringify(value));
  return safeString(value);
}

function eventDate(item = {}) {
  return toDate(item.createdAt || item.created_at || item.occurred_at || item.startAt || item.starts_at || item.next_run_at || item.updatedAt || item.updated_at, new Date(0));
}

function groupLinks(links = []) {
  return links.reduce((acc, link) => {
    const type = safeString(link.source_type);
    if (!type) return acc;
    if (!acc[type]) acc[type] = [];
    acc[type].push(link);
    return acc;
  }, {});
}

class WorkspaceTimelineService {
  constructor(deps = {}) {
    this.WorkspaceEntity = deps.WorkspaceEntity || WorkspaceEntity;
    this.WorkspaceEntityLink = deps.WorkspaceEntityLink || WorkspaceEntityLink;
    this.WorkspaceTimelineEvent = deps.WorkspaceTimelineEvent || WorkspaceTimelineEvent;
    this.Ticket = deps.Ticket || Ticket;
    this.ChannelConversation = deps.ChannelConversation || ChannelConversation;
    this.ChannelMessage = deps.ChannelMessage || ChannelMessage;
    this.Schedule = deps.Schedule || Schedule;
    this.Project = deps.Project || Project;
    this.ProjectItem = deps.ProjectItem || ProjectItem;
    this.RagDocument = deps.RagDocument || RagDocument;
    this.Evidence = deps.Evidence || Evidence;
    this.MarketingLead = deps.MarketingLead || MarketingLead;
    this.Task = deps.Task || Task;
    this.PaymentEvent = deps.PaymentEvent || PaymentEvent;
    this.Tenant = deps.Tenant || Tenant;
    this.logger = deps.logger || logger;
  }

  async getEntity(tenantId, entityId) {
    const entity = await this.WorkspaceEntity().findOne({ where: { tenant_id: tenantId, id: entityId } });
    return toPlain(entity);
  }

  mapEvent({ type, source, refId, date, summary, payload = {}, detailUrl = null, confidence = null }) {
    return {
      id: `${type}:${refId || Math.random().toString(36).slice(2)}`,
      type,
      source,
      refId: refId || null,
      createdAt: toDate(date, new Date()).toISOString(),
      summary: safeString(summary).slice(0, 240) || type,
      detailUrl,
      confidence,
      payload,
    };
  }

  async safeSource(label, fn) {
    try { return await fn(); } catch (err) {
      this.logger.warn(`[WorkspaceTimeline] Fonte ${label} indisponivel`, { error: err.message });
      return [];
    }
  }

  async getLinks({ tenantId, entityId, type = null }) {
    const where = { tenant_id: tenantId, entity_id: entityId };
    if (type) {
      const sourceTypes = Object.entries(SOURCE_TO_TIMELINE_TYPE)
        .filter(([, timelineType]) => timelineType === type || _timelineAlias(type) === timelineType)
        .map(([sourceType]) => sourceType);
      where.source_type = sourceTypes.length > 0 ? { [Op.in]: sourceTypes } : type;
    }
    const rows = await this.WorkspaceEntityLink().findAll({ where, order: [['created_at', 'DESC']], limit: 1000 });
    return rows.map(toPlain);
  }

  async fetchPersistedEvents(tenantId, entityId, type = null) {
    const where = { tenant_id: tenantId, entity_id: entityId };
    if (type) where.type = _timelineAlias(type);
    const rows = await this.WorkspaceTimelineEvent().findAll({ where, order: [['created_at', 'DESC']], limit: 100 });
    return rows.map(toPlain).map((event) => this.mapEvent({
      type: event.type,
      source: event.payload?.source || 'workspace',
      refId: event.ref_id,
      date: event.created_at,
      summary: event.payload?.summary || event.type,
      payload: event.payload || {},
      detailUrl: event.payload?.detailUrl || null,
    }));
  }

  async fetchByIds(ModelFactory, whereBase, ids, order = [['created_at', 'DESC']]) {
    if (!ids.length) return [];
    const rows = await ModelFactory().findAll({ where: { ...whereBase, id: { [Op.in]: ids } }, order, limit: Math.max(ids.length, 100) });
    return rows.map(toPlain);
  }

  async resolveTenantUuid(tenantId) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId || ''))) {
      return tenantId;
    }
    try {
      const tenant = await this.Tenant().findOne({ where: { tenant_key: tenantId } });
      return toPlain(tenant)?.id || null;
    } catch (err) {
      this.logger.warn('[WorkspaceTimeline] Falha ao resolver tenant UUID para projetos', { tenantId, error: err.message });
      return null;
    }
  }

  async projectWhere(tenantId) {
    const tenantUuid = await this.resolveTenantUuid(tenantId);
    return { tenant_id: tenantUuid || tenantId };
  }

  async fetchProjectItemsByIds(tenantId, ids) {
    const items = await this.fetchByIds(this.ProjectItem, {}, ids);
    const projectIds = [...new Set(items.map((item) => item.project_id).filter(Boolean))];
    if (!projectIds.length) return [];
    const projects = await this.fetchByIds(this.Project, await this.projectWhere(tenantId), projectIds);
    const allowedProjectIds = new Set(projects.map((project) => project.id));
    return items.filter((item) => allowedProjectIds.has(item.project_id));
  }

  async buildTimelineFromLinks({ tenantId, entityId, type = null, limit = 50, offset = 0 }) {
    const links = await this.getLinks({ tenantId, entityId, type });
    const grouped = groupLinks(links);
    const linkBy = new Map(links.map((link) => [`${link.source_type}:${link.source_id}`, link]));
    const events = [];

    const pushRows = (sourceType, rows, mapper) => {
      rows.forEach((row) => {
        const link = linkBy.get(`${sourceType}:${row.id}`);
        const event = mapper(row, link);
        if (event) events.push(event);
      });
    };

    await Promise.all([
      this.safeSource('conversation-links', async () => pushRows('conversation', await this.fetchByIds(this.ChannelConversation, { tenant_key: tenantId }, (grouped.conversation || []).map(l => l.source_id), [['last_message_at', 'DESC'], ['created_at', 'DESC']]), (item, link) => this.mapEvent({ type: 'conversation', source: item.channel_type || 'channel', refId: item.id, date: item.last_message_at || item.created_at, summary: `Conversa ${item.status || 'aberta'} em ${item.channel_type || 'canal'}`, payload: item, detailUrl: `/inbox?conversationId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('message-links', async () => pushRows('message', await this.fetchByIds(this.ChannelMessage, { tenant_key: tenantId }, (grouped.message || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'message', source: item.channel_type || 'channel', refId: item.id, date: item.created_at, summary: `${item.direction || 'mensagem'}: ${firstText(item.body)}`, payload: item, detailUrl: `/inbox?conversationId=${encodeURIComponent(item.conversation_id)}`, confidence: link?.confidence }))),
      this.safeSource('ticket-links', async () => pushRows('ticket', await this.fetchByIds(this.Ticket, { tenant_key: tenantId }, (grouped.ticket || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'ticket', source: item.channel_type || 'support', refId: item.id, date: item.created_at, summary: `Ticket ${item.status || ''} ${item.queue ? `na fila ${item.queue}` : ''}`.trim(), payload: item, detailUrl: `/support?ticketId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('task-links', async () => pushRows('task', await this.fetchByIds(this.Task, { tenant_id: tenantId }, (grouped.task || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'task', source: item.type || 'task', refId: item.id, date: item.updated_at || item.created_at || item.due_date, summary: `${item.status === 'completed' ? 'Tarefa concluida' : 'Tarefa'}: ${item.title}`, payload: item, detailUrl: `/tasks?taskId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('schedule-links', async () => pushRows('schedule', await this.fetchByIds(this.Schedule, { tenant_key: tenantId }, (grouped.schedule || []).map(l => l.source_id), [['next_run_at', 'DESC'], ['created_at', 'DESC']]), (item, link) => this.mapEvent({ type: 'schedule', source: item.kind || 'schedule', refId: item.id, date: item.next_run_at || item.created_at, summary: item.name || item.payload?.purpose || 'Agendamento', payload: item, detailUrl: `/agenda?scheduleId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('project-links', async () => pushRows('project', await this.fetchByIds(this.Project, await this.projectWhere(tenantId), (grouped.project || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'project', source: 'projects', refId: item.id, date: item.updated_at || item.created_at, summary: `Projeto ${item.name || item.code || item.id}`, payload: item, detailUrl: `/projects/${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('project-item-links', async () => pushRows('project_item', await this.fetchProjectItemsByIds(tenantId, (grouped.project_item || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'project', source: 'project_item', refId: item.id, date: item.updated_at || item.created_at, summary: `Item de projeto ${item.title || item.id}`, payload: item, detailUrl: `/projects/${encodeURIComponent(item.project_id || '')}`, confidence: link?.confidence }))),
      this.safeSource('document-links', async () => pushRows('document', await this.fetchByIds(this.RagDocument, { tenant_key: tenantId }, (grouped.document || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'document', source: 'rag', refId: item.id, date: item.updated_at || item.created_at, summary: item.title || 'Documento RAG relacionado', payload: item, detailUrl: `/rag-documents?documentId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('evidence-links', async () => pushRows('evidence', await this.fetchByIds(this.Evidence, { tenant_key: tenantId }, (grouped.evidence || []).map(l => l.source_id), [['occurred_at', 'DESC']]), (item, link) => this.mapEvent({ type: 'evidence', source: item.source_type || 'QA/RPA', refId: item.id, date: item.occurred_at || item.created_at, summary: item.summary || item.excerpt || 'Evidencia relacionada', payload: { ...item, replayUrl: item.source_ref?.replayUrl || item.metadata?.replayUrl || null }, detailUrl: item.source_ref?.replayUrl || item.metadata?.replayUrl || `/dev/rpa-replays?evidenceId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('lead-links', async () => pushRows('lead', await this.fetchByIds(this.MarketingLead, { tenant_key: tenantId }, (grouped.lead || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'lead', source: 'marketing', refId: item.id, date: item.last_seen_at || item.updated_at || item.created_at, summary: `Lead ${item.stage || ''} score ${item.score || 0}`, payload: item, detailUrl: `/marketing?leadId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
      this.safeSource('payment-links', async () => pushRows('payment', await this.fetchByIds(this.PaymentEvent, { tenant_id: tenantId }, (grouped.payment || []).map(l => l.source_id)), (item, link) => this.mapEvent({ type: 'payment', source: 'billing', refId: item.id, date: item.created_at, summary: `Pagamento ${item.type || ''} ${item.status || ''} - ${item.amount}`, payload: item, detailUrl: `/workspace?paymentId=${encodeURIComponent(item.id)}`, confidence: link?.confidence }))),
    ]);

    const persisted = await this.fetchPersistedEvents(tenantId, entityId, type);
    const sorted = uniqBy([...events, ...persisted], (item) => `${item.type}:${item.refId || item.summary}`).sort((a, b) => eventDate(b) - eventDate(a));
    return { items: sorted.slice(offset, offset + limit), total: sorted.length, limit, offset, hasMore: offset + limit < sorted.length, links: links.length };
  }

  async getEntityTimeline({ tenantId, entityId, limit, offset, type = null, classification, internal = false }) {
    const entity = await this.getEntity(tenantId, entityId);
    if (!entity) return null;
    const timeline = await this.buildTimelineFromLinks({ tenantId, entityId, type: type ? _timelineAlias(type) : null, limit: clampLimit(limit, 50, 100), offset: offsetValue(offset) });
    if (internal) return timeline;
    return { ...timeline, items: sanitizeTimelineEvents(timeline.items, classification) };
  }
}

function _timelineAlias(type) {
  const value = safeString(type).trim().toLowerCase();
  if (value === 'conversas' || value === 'conversation') return 'message';
  if (value === 'tickets') return 'ticket';
  if (value === 'tarefas') return 'task';
  if (value === 'agenda') return 'schedule';
  if (value === 'projetos') return 'project';
  if (value === 'documentos') return 'document';
  if (value === 'qa' || value === 'rpa' || value === 'qa/rpa') return 'evidence';
  return value;
}

module.exports = WorkspaceTimelineService;

'use strict';

const { Op, fn, col } = require('sequelize');
const {
  WorkspaceEntityLink,
  WorkspaceTimelineEvent,
  WorkspaceInsight,
  WorkspaceAction,
  Ticket,
  PaymentEvent,
} = require('../../db/models');
const logger = require('../../utils/logger');
const WorkspaceInsightService = require('./WorkspaceInsightService');
const { toPlain, toDate } = require('./workspaceUtils');

const OPEN_TICKET_STATUSES = WorkspaceInsightService.OPEN_TICKET_STATUSES;
const PENDING_ACTION_STATUSES = ['pending', 'open'];
const PENDING_PAYMENT_STATUSES = ['pending'];

class WorkspaceSummaryService {
  constructor(deps = {}) {
    this.WorkspaceEntityLink = deps.WorkspaceEntityLink || WorkspaceEntityLink;
    this.WorkspaceTimelineEvent = deps.WorkspaceTimelineEvent || WorkspaceTimelineEvent;
    this.WorkspaceInsight = deps.WorkspaceInsight || WorkspaceInsight;
    this.WorkspaceAction = deps.WorkspaceAction || WorkspaceAction;
    this.Ticket = deps.Ticket || Ticket;
    this.PaymentEvent = deps.PaymentEvent || PaymentEvent;
    this.logger = deps.logger || logger;
  }

  emptySummary(entity = {}) {
    const entityInteraction = toDate(entity.last_interaction_at);
    return {
      openTickets: 0,
      pendingActions: 0,
      pendingPayments: 0,
      riskLevel: 'none',
      lastInteractionAt: entityInteraction ? entityInteraction.toISOString() : null,
    };
  }

  async countByEntity(ModelFactory, where) {
    const rows = await ModelFactory().findAll({
      attributes: ['entity_id', [fn('COUNT', col('id')), 'count']],
      where,
      group: ['entity_id'],
      raw: true,
    });
    const map = new Map();
    for (const row of rows || []) {
      map.set(row.entity_id, Number(row.count) || 0);
    }
    return map;
  }

  async lastTimelineEventByEntity(tenantId, entityIds) {
    const rows = await this.WorkspaceTimelineEvent().findAll({
      attributes: ['entity_id', [fn('MAX', col('created_at')), 'last_at']],
      where: { tenant_id: tenantId, entity_id: { [Op.in]: entityIds } },
      group: ['entity_id'],
      raw: true,
    });
    const map = new Map();
    for (const row of rows || []) {
      const date = toDate(row.last_at);
      if (date) map.set(row.entity_id, date.toISOString());
    }
    return map;
  }

  async openTicketsByEntity(tenantId, entityIds) {
    const map = new Map();
    const links = (await this.WorkspaceEntityLink().findAll({
      where: { tenant_id: tenantId, entity_id: { [Op.in]: entityIds }, source_type: 'ticket' },
    })).map(toPlain);
    if (!links.length) return map;

    const ticketIds = [...new Set(links.map((link) => link.source_id).filter(Boolean))];
    if (!ticketIds.length) return map;
    const openTickets = (await this.Ticket().findAll({
      attributes: ['id'],
      where: { tenant_key: tenantId, id: { [Op.in]: ticketIds }, status: { [Op.in]: [...OPEN_TICKET_STATUSES] } },
    })).map(toPlain);
    const openIds = new Set(openTickets.map((ticket) => ticket.id));

    for (const link of links) {
      if (!openIds.has(link.source_id)) continue;
      map.set(link.entity_id, (map.get(link.entity_id) || 0) + 1);
    }
    return map;
  }

  async summarize({ tenantId, entities = [] }) {
    const items = (Array.isArray(entities) ? entities : []).filter((item) => item && item.id);
    const summaries = new Map(items.map((item) => [item.id, this.emptySummary(item)]));
    const entityIds = items.map((item) => item.id);
    if (!entityIds.length) return summaries;

    const scope = { tenant_id: tenantId, entity_id: { [Op.in]: entityIds } };
    const [actionCounts, paymentCounts, criticalCounts, lastEvents, openTickets] = await Promise.all([
      this.countByEntity(this.WorkspaceAction, { ...scope, status: { [Op.in]: PENDING_ACTION_STATUSES } }),
      this.countByEntity(this.PaymentEvent, { ...scope, status: { [Op.in]: PENDING_PAYMENT_STATUSES } }),
      // WorkspaceInsight nao persiste `severity` (modelo: type/description/confidence/source).
      // Proxy de insight critico: risco com confianca >= 0.9 (inclui o insight tecnico RPA, confidence 0.94).
      this.countByEntity(this.WorkspaceInsight, { ...scope, type: 'risk', confidence: { [Op.gte]: 0.9 } }),
      this.lastTimelineEventByEntity(tenantId, entityIds),
      this.openTicketsByEntity(tenantId, entityIds),
    ]);

    for (const [entityId, summary] of summaries) {
      summary.openTickets = openTickets.get(entityId) || 0;
      summary.pendingActions = actionCounts.get(entityId) || 0;
      summary.pendingPayments = paymentCounts.get(entityId) || 0;
      summary.lastInteractionAt = summary.lastInteractionAt || lastEvents.get(entityId) || null;
      const critical = summary.openTickets >= 2 || (criticalCounts.get(entityId) || 0) > 0;
      const attention = summary.openTickets >= 1 || summary.pendingPayments > 0 || summary.pendingActions > 0;
      summary.riskLevel = critical ? 'critical' : attention ? 'attention' : 'none';
    }

    return summaries;
  }
}

module.exports = WorkspaceSummaryService;

'use strict';

const { Op } = require('sequelize');
const queueService = require('./queueService');
const eventLedgerService = require('./eventLedgerService');
const {
  ChannelConversation,
  ChannelMessage,
  Ticket,
  AccessMembership,
  AccessSubject,
} = require('../db/models');
const {
  ensureTenantId,
  safeString,
  normalizePhone,
  extractBodyText,
  toArray,
  uniqEntities,
} = require('./evidenceUtils');

function createEvidenceTimelineService(deps = {}) {
  const ConversationModel = deps.ChannelConversation || ChannelConversation;
  const MessageModel = deps.ChannelMessage || ChannelMessage;
  const TicketModel = deps.Ticket || Ticket;
  const AccessMembershipModel = deps.AccessMembership || AccessMembership;
  const AccessSubjectModel = deps.AccessSubject || AccessSubject;
  const queue = deps.queueService || queueService;
  const ledger = deps.eventLedgerService || eventLedgerService;

  async function resolveTicket(tenantId, ticketId) {
    if (!ticketId) return null;
    const inMemory = typeof queue.getTicket === 'function' ? queue.getTicket(ticketId) : null;
    if (inMemory && safeString(inMemory.tenantId) === tenantId) return inMemory;
    try {
      const row = await TicketModel().findOne({ where: { tenant_key: tenantId, id: safeString(ticketId) } });
      return row ? (row.toJSON ? row.toJSON() : row) : null;
    } catch (_) {
      return null;
    }
  }

  async function listTicketsByContext({ tenantId, identity, conversationIds, phone }) {
    const items = [];
    const seen = new Set();
    const addTicket = (ticket) => {
      if (!ticket || seen.has(ticket.id)) return;
      seen.add(ticket.id);
      items.push(ticket);
    };

    const explicit = await resolveTicket(tenantId, identity.context?.ticketId || null);
    addTicket(explicit);

    try {
      const where = { tenant_key: tenantId };
      const orFilters = [];
      if (conversationIds.length > 0) {
        orFilters.push({ conversation_id: { [Op.in]: conversationIds } });
      }
      if (phone) {
        orFilters.push({ phone_number: phone });
      }
      if (orFilters.length > 0) {
        where[Op.or] = orFilters;
        const rows = await TicketModel().findAll({
          where,
          order: [['created_at', 'DESC']],
          limit: 50,
        });
        for (const row of rows || []) addTicket(row.toJSON ? row.toJSON() : row);
      }
    } catch (_) {}

    if (identity.entityType && identity.entityId && typeof queue.listAllTickets === 'function') {
      const queued = queue.listAllTickets({ tenantId }).tickets || [];
      for (const ticket of queued) {
        const ctx = ticket.context && typeof ticket.context === 'object' ? ticket.context : {};
        if (
          safeString(ctx.customerId || ctx.customer_id) === identity.entityId
          || safeString(ctx.subjectId || ctx.subject_id) === identity.entityId
          || safeString(ctx.membershipId || ctx.membership_id) === identity.entityId
        ) {
          addTicket(ticket);
        }
      }
    }

    return items;
  }

  async function listConversations({ tenantId, ticket, explicitConversationId, identity, phone }) {
    const conversationIds = uniqEntities([
      explicitConversationId ? { type: 'conversation', id: explicitConversationId } : null,
      safeString(ticket?.conversationId || ticket?.conversation_id) ? { type: 'conversation', id: ticket.conversationId || ticket.conversation_id } : null,
      ...(identity.relatedEntities || []).filter((item) => item.type === 'conversation'),
    ]).map((item) => item.id);

    const rows = [];
    const seen = new Set();

    async function addByWhere(where) {
      try {
        const found = await ConversationModel().findAll({
          where,
          order: [['last_message_at', 'DESC']],
          limit: 50,
        });
        for (const row of found || []) {
          const item = row.toJSON ? row.toJSON() : row;
          if (!seen.has(item.id)) {
            seen.add(item.id);
            rows.push(item);
          }
        }
      } catch (_) {}
    }

    if (conversationIds.length > 0) {
      await addByWhere({ tenant_key: tenantId, id: { [Op.in]: conversationIds } });
    }
    if (phone) {
      await addByWhere({
        tenant_key: tenantId,
        [Op.or]: [
          { external_id: phone },
          { contact_id: phone.replace(/^\+/, '') },
        ],
      });
    }

    return rows;
  }

  async function listMessages({ tenantId, conversationIds }) {
    if (conversationIds.length === 0) return [];
    try {
      const rows = await MessageModel().findAll({
        where: {
          tenant_key: tenantId,
          conversation_id: { [Op.in]: conversationIds },
        },
        order: [['created_at', 'ASC']],
        limit: 500,
      });
      return (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    } catch (_) {
      return [];
    }
  }

  async function listDomainLinks({ tenantId, identity }) {
    const links = [];
    const related = uniqEntities(identity.relatedEntities || []);
    if (identity.entityType === 'membership' || related.some((item) => item.type === 'membership')) {
      const membershipId = identity.entityType === 'membership'
        ? identity.entityId
        : related.find((item) => item.type === 'membership')?.id;
      if (membershipId) {
        try {
          const row = await AccessMembershipModel().findOne({
            where: { tenant_key: tenantId, id: membershipId },
          });
          const item = row ? (row.toJSON ? row.toJSON() : row) : null;
          if (item) {
            links.push({
              id: `membership:${item.id}`,
              timestamp: item.updated_at || item.created_at,
              type: 'membership_snapshot',
              source: 'access_membership',
              sourceType: 'system',
              title: `Membership ${item.id}`,
              text: `Plano ${safeString(item.plan_name)} com status ${safeString(item.billing_status || item.status)}`.trim(),
              entityType: 'membership',
              entityId: item.id,
              relatedEntities: uniqEntities([
                { type: 'subject', id: item.subject_id },
                { type: 'customer', id: item.customer_id },
              ]),
              metadata: item,
            });
          }
        } catch (_) {}
      }
    }
    if (identity.entityType === 'subject' || related.some((item) => item.type === 'subject')) {
      const subjectId = identity.entityType === 'subject'
        ? identity.entityId
        : related.find((item) => item.type === 'subject')?.id;
      if (subjectId) {
        try {
          const row = await AccessSubjectModel().findOne({
            where: { tenant_key: tenantId, id: subjectId },
          });
          const item = row ? (row.toJSON ? row.toJSON() : row) : null;
          if (item) {
            links.push({
              id: `subject:${item.id}`,
              timestamp: item.updated_at || item.created_at,
              type: 'subject_snapshot',
              source: 'access_subject',
              sourceType: 'system',
              title: `Subject ${item.id}`,
              text: `Status ${safeString(item.status)} para profile ${safeString(item.vertical_profile)}`.trim(),
              entityType: 'subject',
              entityId: item.id,
              relatedEntities: uniqEntities([
                { type: 'customer', id: item.customer_id },
                { type: 'membership', id: item.membership_id },
              ]),
              metadata: item,
            });
          }
        } catch (_) {}
      }
    }
    return links;
  }

  async function getTimeline(input = {}) {
    const tenantId = ensureTenantId(input.tenantId);
    const identity = input.identity || null;
    if (!identity?.entityType || !identity?.entityId) {
      return { ok: false, identity, items: [] };
    }

    const explicitContext = input.context || {};
    const explicitConversationId = safeString(input.conversationId || explicitContext.conversationId).trim();
    const ticket = await resolveTicket(tenantId, safeString(input.ticketId || explicitContext.ticketId).trim());
    const phone = normalizePhone(
      input.phone
      || explicitContext.phone
      || ticket?.phoneNumber
      || ticket?.phone_number
      || ticket?.context?.phone,
    );

    const conversations = await listConversations({
      tenantId,
      ticket,
      explicitConversationId,
      identity: { ...identity, context: explicitContext },
      phone,
    });
    const conversationIds = conversations.map((item) => item.id);
    const messages = await listMessages({ tenantId, conversationIds });
    const tickets = await listTicketsByContext({
      tenantId,
      identity: { ...identity, context: explicitContext },
      conversationIds,
      phone,
    });
    const domainLinks = await listDomainLinks({ tenantId, identity });

    const events = [];
    const eventEntities = uniqEntities([
      { type: identity.entityType, id: identity.entityId },
      ...(identity.relatedEntities || []),
    ]);
    for (const entity of eventEntities) {
      try {
        const listed = await ledger.listEvents({
          tenantId,
          subjectType: entity.type,
          subjectId: entity.id,
          limit: 100,
        });
        for (const item of listed.items || []) {
          events.push(item);
        }
      } catch (_) {}
    }

    const items = [];

    for (const conversation of conversations) {
      items.push({
        id: `conversation:${conversation.id}`,
        timestamp: conversation.last_message_at || conversation.updated_at || conversation.created_at,
        type: 'conversation',
        source: 'channel_conversation',
        sourceType: 'system',
        title: `${safeString(conversation.channel_type)} conversation`,
        text: `Conversation ${conversation.id} com status ${safeString(conversation.status)}`.trim(),
        entityType: identity.entityType,
        entityId: identity.entityId,
        relatedEntities: uniqEntities([
          { type: 'conversation', id: conversation.id },
          conversation.current_ticket_id ? { type: 'ticket', id: conversation.current_ticket_id } : null,
          phone ? { type: 'contact', id: phone } : null,
        ]),
        ticketId: conversation.current_ticket_id || null,
        conversationId: conversation.id,
        metadata: conversation,
      });
    }

    for (const message of messages) {
      const bodyText = extractBodyText(message.body);
      items.push({
        id: `message:${message.id}`,
        timestamp: message.created_at || message.updated_at,
        type: 'message',
        source: 'channel_message',
        sourceType: 'channel_message',
        direction: safeString(message.direction),
        title: `${safeString(message.channel_type)} ${safeString(message.direction)} message`,
        text: bodyText,
        body: message.body,
        entityType: identity.entityType,
        entityId: identity.entityId,
        relatedEntities: uniqEntities([
          { type: 'conversation', id: message.conversation_id },
          phone ? { type: 'contact', id: phone } : null,
        ]),
        conversationId: message.conversation_id,
        metadata: message,
        attachments: toArray(message.body?.attachments || message.body?.files || []),
      });
    }

    for (const item of tickets) {
      const ticketContext = item.context && typeof item.context === 'object' ? item.context : {};
      items.push({
        id: `ticket:${item.id}`,
        timestamp: item.updatedAt || item.updated_at || item.createdAt || item.created_at,
        type: 'ticket',
        source: 'ticket',
        sourceType: 'system',
        title: `Ticket ${item.id}`,
        text: item.lastUserMessage || item.last_user_message || '',
        entityType: identity.entityType,
        entityId: identity.entityId,
        relatedEntities: uniqEntities([
          { type: 'ticket', id: item.id },
          item.conversationId || item.conversation_id ? { type: 'conversation', id: item.conversationId || item.conversation_id } : null,
          safeString(ticketContext.membershipId || ticketContext.membership_id) ? { type: 'membership', id: ticketContext.membershipId || ticketContext.membership_id } : null,
          safeString(ticketContext.subjectId || ticketContext.subject_id) ? { type: 'subject', id: ticketContext.subjectId || ticketContext.subject_id } : null,
          safeString(ticketContext.customerId || ticketContext.customer_id) ? { type: 'customer', id: ticketContext.customerId || ticketContext.customer_id } : null,
        ]),
        ticketId: item.id,
        conversationId: item.conversationId || item.conversation_id || null,
        metadata: item,
      });

      for (const message of toArray(item.messages)) {
        items.push({
          id: `ticket-message:${item.id}:${safeString(message.id || message.timestamp || items.length)}`,
          timestamp: message.timestamp || item.updatedAt || item.updated_at,
          type: message.sender === 'system' ? 'ticket_note' : 'ticket_message',
          source: message.sender === 'system' ? 'ticket_note' : 'ticket_message',
          sourceType: message.sender === 'system' ? 'ticket_note' : 'ticket_message',
          title: `Ticket ${item.id} ${message.sender || 'message'}`,
          text: safeString(message.text || message.body),
          entityType: identity.entityType,
          entityId: identity.entityId,
          relatedEntities: uniqEntities([{ type: 'ticket', id: item.id }]),
          ticketId: item.id,
          conversationId: item.conversationId || item.conversation_id || null,
          metadata: { ticketId: item.id, sender: message.sender },
          actorType: message.sender === 'agent' ? 'agent' : message.sender === 'system' ? 'system' : 'customer',
        });
      }
    }

    for (const event of events) {
      items.push({
        id: `event:${event.id}`,
        timestamp: event.occurred_at || event.received_at,
        type: 'event',
        eventType: event.type,
        source: 'event_ledger',
        sourceType: 'event_ledger',
        title: event.type,
        text: extractBodyText(event.payload),
        entityType: safeString(event.subject_type) || identity.entityType,
        entityId: safeString(event.subject_id) || identity.entityId,
        relatedEntities: uniqEntities([
          { type: safeString(event.subject_type), id: safeString(event.subject_id) },
          safeString(event.payload?.ticketId) ? { type: 'ticket', id: event.payload.ticketId } : null,
          safeString(event.payload?.conversationId) ? { type: 'conversation', id: event.payload.conversationId } : null,
        ]),
        ticketId: safeString(event.payload?.ticketId) || null,
        conversationId: safeString(event.payload?.conversationId) || null,
        actorType: safeString(event.actor_type) || null,
        actorId: safeString(event.actor_id) || null,
        metadata: event.payload || {},
      });
    }

    items.push(...domainLinks);
    items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    return {
      ok: true,
      identity,
      items,
    };
  }

  return {
    getTimeline,
  };
}

module.exports = createEvidenceTimelineService();
module.exports.createEvidenceTimelineService = createEvidenceTimelineService;

'use strict';

const { Op } = require('sequelize');
const queueService = require('./queueService');
const { ChannelConversation, Ticket, AccessMembership, AccessSubject } = require('../db/models');
const {
  ensureTenantId,
  safeString,
  normalizePhone,
  uniqEntities,
} = require('./evidenceUtils');

function createEvidenceIdentityService(deps = {}) {
  const ConversationModel = deps.ChannelConversation || ChannelConversation;
  const TicketModel = deps.Ticket || Ticket;
  const AccessMembershipModel = deps.AccessMembership || AccessMembership;
  const AccessSubjectModel = deps.AccessSubject || AccessSubject;
  const queue = deps.queueService || queueService;

  function makeCandidate({ entityType, entityId, confidence, reason, sources = [], relatedEntities = [] }) {
    return {
      entityType: safeString(entityType),
      entityId: safeString(entityId),
      confidence: Number(confidence) || 0,
      reason: safeString(reason),
      sources,
      relatedEntities: uniqEntities(relatedEntities),
    };
  }

  async function fetchTicketContext({ tenantId, ticketId }) {
    if (!ticketId) return null;
    const inMemory = typeof queue.getTicket === 'function' ? queue.getTicket(ticketId) : null;
    if (inMemory && safeString(inMemory.tenantId) === tenantId) {
      return inMemory;
    }
    try {
      const row = await TicketModel().findOne({
        where: {
          tenant_key: tenantId,
          id: safeString(ticketId),
        },
      });
      return row ? (row.toJSON ? row.toJSON() : row) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchConversation({ tenantId, conversationId }) {
    if (!conversationId) return null;
    try {
      const row = await ConversationModel().findOne({
        where: {
          tenant_key: tenantId,
          id: safeString(conversationId),
        },
      });
      return row ? (row.toJSON ? row.toJSON() : row) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchMembership({ tenantId, membershipId }) {
    if (!membershipId) return null;
    try {
      const row = await AccessMembershipModel().findOne({
        where: {
          tenant_key: tenantId,
          id: safeString(membershipId),
        },
      });
      return row ? (row.toJSON ? row.toJSON() : row) : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchSubject({ tenantId, subjectId, customerId = null, membershipId = null }) {
    try {
      const filters = [];
      if (subjectId) filters.push({ id: safeString(subjectId) });
      if (customerId) filters.push({ customer_id: safeString(customerId) });
      if (membershipId) filters.push({ membership_id: safeString(membershipId) });
      if (filters.length === 0) return null;
      const row = await AccessSubjectModel().findOne({
        where: {
          tenant_key: tenantId,
          [Op.or]: filters,
        },
      });
      return row ? (row.toJSON ? row.toJSON() : row) : null;
    } catch (_) {
      return null;
    }
  }

  async function resolveIdentity(input = {}) {
    const tenantId = ensureTenantId(input.tenantId);
    const explicitEntityType = safeString(input.entityType || input.context?.entityType).trim();
    const explicitEntityId = safeString(input.entityId || input.context?.entityId).trim();
    const explicitMembershipId = safeString(input.membershipId || input.context?.membershipId).trim();
    const explicitSubjectId = safeString(input.subjectId || input.context?.subjectId).trim();
    const explicitCustomerId = safeString(input.customerId || input.context?.customerId).trim();
    const explicitPhone = normalizePhone(input.phone || input.context?.phone);
    const explicitContactId = safeString(input.contactId || input.context?.contactId).trim();
    const ticketId = safeString(input.ticketId || input.context?.ticketId).trim();
    const conversationId = safeString(input.conversationId || input.context?.conversationId).trim();

    const candidates = [];
    const sources = [];
    const relatedEntities = [];

    if (explicitEntityType && explicitEntityId) {
      candidates.push(makeCandidate({
        entityType: explicitEntityType,
        entityId: explicitEntityId,
        confidence: 0.99,
        reason: 'explicit_entity',
        sources: [{ type: 'request', field: 'entity', entityType: explicitEntityType, entityId: explicitEntityId }],
      }));
    }

    let ticket = null;
    if (ticketId) {
      ticket = await fetchTicketContext({ tenantId, ticketId });
      if (ticket) {
        const ticketContext = ticket.context && typeof ticket.context === 'object' ? ticket.context : {};
        const ticketPhone = normalizePhone(ticket.phoneNumber || ticket.phone_number || ticketContext.phone);
        const ticketMembershipId = safeString(ticketContext.membershipId || ticketContext.membership_id).trim();
        const ticketSubjectId = safeString(ticketContext.subjectId || ticketContext.subject_id).trim();
        const ticketCustomerId = safeString(ticketContext.customerId || ticketContext.customer_id).trim();
        const ticketContactId = safeString(ticketContext.contactId || ticketContext.contact_id).trim();
        sources.push({ type: 'ticket', id: ticket.id });
        relatedEntities.push({ type: 'ticket', id: ticket.id });
        if (ticketMembershipId) {
          candidates.push(makeCandidate({
            entityType: 'membership',
            entityId: ticketMembershipId,
            confidence: 0.92,
            reason: 'ticket_context_membership',
            sources: [{ type: 'ticket', id: ticket.id, field: 'context.membershipId' }],
            relatedEntities: [{ type: 'ticket', id: ticket.id }],
          }));
        }
        if (ticketSubjectId) {
          candidates.push(makeCandidate({
            entityType: 'subject',
            entityId: ticketSubjectId,
            confidence: 0.94,
            reason: 'ticket_context_subject',
            sources: [{ type: 'ticket', id: ticket.id, field: 'context.subjectId' }],
            relatedEntities: [{ type: 'ticket', id: ticket.id }],
          }));
        }
        if (ticketCustomerId) {
          candidates.push(makeCandidate({
            entityType: 'customer',
            entityId: ticketCustomerId,
            confidence: 0.96,
            reason: 'ticket_context_customer',
            sources: [{ type: 'ticket', id: ticket.id, field: 'context.customerId' }],
            relatedEntities: [{ type: 'ticket', id: ticket.id }],
          }));
        }
        if (ticketPhone || ticketContactId) {
          candidates.push(makeCandidate({
            entityType: 'contact',
            entityId: ticketPhone || ticketContactId,
            confidence: 0.72,
            reason: 'ticket_contact_ref',
            sources: [{ type: 'ticket', id: ticket.id, field: ticketPhone ? 'phone' : 'contactId' }],
            relatedEntities: [{ type: 'ticket', id: ticket.id }],
          }));
        }
      }
    }

    let conversation = null;
    const effectiveConversationId = conversationId || safeString(ticket?.conversationId || ticket?.conversation_id).trim();
    if (effectiveConversationId) {
      conversation = await fetchConversation({ tenantId, conversationId: effectiveConversationId });
      if (conversation) {
        const conversationPhone = normalizePhone(conversation.external_id);
        const conversationContactId = safeString(conversation.contact_id).trim();
        sources.push({ type: 'conversation', id: conversation.id });
        relatedEntities.push({ type: 'conversation', id: conversation.id });
        if (conversationPhone || conversationContactId) {
          candidates.push(makeCandidate({
            entityType: 'contact',
            entityId: conversationPhone || conversationContactId,
            confidence: 0.78,
            reason: 'conversation_contact_ref',
            sources: [{ type: 'conversation', id: conversation.id, field: conversationPhone ? 'external_id' : 'contact_id' }],
            relatedEntities: [{ type: 'conversation', id: conversation.id }],
          }));
        }
      }
    }

    if (explicitPhone || explicitContactId) {
      candidates.push(makeCandidate({
        entityType: 'contact',
        entityId: explicitPhone || explicitContactId,
        confidence: explicitPhone ? 0.84 : 0.76,
        reason: explicitPhone ? 'explicit_phone' : 'explicit_contact',
        sources: [{ type: 'request', field: explicitPhone ? 'phone' : 'contactId' }],
      }));
    }

    const membership = await fetchMembership({ tenantId, membershipId: explicitMembershipId });
    if (membership) {
      relatedEntities.push({ type: 'membership', id: membership.id });
      candidates.push(makeCandidate({
        entityType: 'membership',
        entityId: membership.id,
        confidence: 0.97,
        reason: 'explicit_membership',
        sources: [{ type: 'request', field: 'membershipId', id: membership.id }],
        relatedEntities: [
          { type: 'subject', id: membership.subject_id },
          { type: 'customer', id: membership.customer_id },
        ],
      }));
      if (membership.customer_id) {
        candidates.push(makeCandidate({
          entityType: 'customer',
          entityId: membership.customer_id,
          confidence: 0.95,
          reason: 'membership_customer_link',
          sources: [{ type: 'membership', id: membership.id, field: 'customer_id' }],
          relatedEntities: [{ type: 'membership', id: membership.id }, { type: 'subject', id: membership.subject_id }],
        }));
      }
      if (membership.subject_id) {
        candidates.push(makeCandidate({
          entityType: 'subject',
          entityId: membership.subject_id,
          confidence: 0.95,
          reason: 'membership_subject_link',
          sources: [{ type: 'membership', id: membership.id, field: 'subject_id' }],
          relatedEntities: [{ type: 'membership', id: membership.id }, { type: 'customer', id: membership.customer_id }],
        }));
      }
    }

    const subject = await fetchSubject({
      tenantId,
      subjectId: explicitSubjectId,
      customerId: explicitCustomerId,
      membershipId: explicitMembershipId || membership?.id || null,
    });
    if (subject) {
      relatedEntities.push({ type: 'subject', id: subject.id });
      candidates.push(makeCandidate({
        entityType: 'subject',
        entityId: subject.id,
        confidence: explicitSubjectId ? 0.97 : 0.92,
        reason: explicitSubjectId ? 'explicit_subject' : 'subject_lookup',
        sources: [{ type: 'subject', id: subject.id }],
        relatedEntities: [{ type: 'customer', id: subject.customer_id }, { type: 'membership', id: subject.membership_id }],
      }));
      if (subject.customer_id) {
        candidates.push(makeCandidate({
          entityType: 'customer',
          entityId: subject.customer_id,
          confidence: 0.95,
          reason: 'subject_customer_link',
          sources: [{ type: 'subject', id: subject.id, field: 'customer_id' }],
          relatedEntities: [{ type: 'subject', id: subject.id }, { type: 'membership', id: subject.membership_id }],
        }));
      }
      if (subject.membership_id) {
        candidates.push(makeCandidate({
          entityType: 'membership',
          entityId: subject.membership_id,
          confidence: 0.9,
          reason: 'subject_membership_link',
          sources: [{ type: 'subject', id: subject.id, field: 'membership_id' }],
          relatedEntities: [{ type: 'subject', id: subject.id }, { type: 'customer', id: subject.customer_id }],
        }));
      }
    }

    if (explicitCustomerId) {
      candidates.push(makeCandidate({
        entityType: 'customer',
        entityId: explicitCustomerId,
        confidence: 0.97,
        reason: 'explicit_customer',
        sources: [{ type: 'request', field: 'customerId', id: explicitCustomerId }],
      }));
    }

    const priority = {
      customer: 60,
      subject: 50,
      membership: 45,
      contact: 30,
      conversation: 20,
      ticket: 10,
    };

    const dedupedCandidates = [];
    const seen = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.entityType}:${candidate.entityId}`;
      const current = seen.get(key);
      if (!current || current.confidence < candidate.confidence) {
        seen.set(key, candidate);
      }
    }
    for (const candidate of seen.values()) {
      dedupedCandidates.push(candidate);
    }
    dedupedCandidates.sort((a, b) => {
      const aScore = (priority[a.entityType] || 0) + a.confidence * 100;
      const bScore = (priority[b.entityType] || 0) + b.confidence * 100;
      return bScore - aScore;
    });

    const best = dedupedCandidates[0] || null;
    if (!best) {
      return {
        ok: false,
        identity: null,
        candidates: [],
      };
    }

    const bestRelated = uniqEntities([
      ...relatedEntities,
      ...best.relatedEntities,
      explicitMembershipId ? { type: 'membership', id: explicitMembershipId } : null,
      explicitSubjectId ? { type: 'subject', id: explicitSubjectId } : null,
      explicitCustomerId ? { type: 'customer', id: explicitCustomerId } : null,
      effectiveConversationId ? { type: 'conversation', id: effectiveConversationId } : null,
      ticketId ? { type: 'ticket', id: ticketId } : null,
    ]).filter((item) => !(item.type === best.entityType && item.id === best.entityId));

    return {
      ok: true,
      identity: {
        entityType: best.entityType,
        entityId: best.entityId,
        confidence: best.confidence,
        sources: [...sources, ...best.sources],
        relatedEntities: bestRelated,
      },
      candidates: dedupedCandidates,
    };
  }

  return {
    resolveIdentity,
  };
}

module.exports = createEvidenceIdentityService();
module.exports.createEvidenceIdentityService = createEvidenceIdentityService;

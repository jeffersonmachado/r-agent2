'use strict';

const WorkspaceEntityService = require('./WorkspaceEntityService');
const { safeString } = require('./workspaceUtils');

class WorkspaceLinkAutomationService {
  constructor(deps = {}) {
    this.entityService = deps.entityService || new WorkspaceEntityService(deps);
  }

  async linkConversationCreated({ tenantId, conversation }) {
    if (!conversation?.id) return null;
    return this.entityService.linkSourceToEntity({
      tenantId,
      sourceType: 'conversation',
      sourceId: conversation.id,
      confidence: conversation.contact_id ? 0.92 : 0.82,
      contact: {
        phone: conversation.external_id,
        name: conversation.contact_id || conversation.external_id,
        refId: conversation.id,
      },
    });
  }

  async linkMessageReceived({ tenantId, conversation, messageId }) {
    if (!messageId) return null;
    const link = await this.linkConversationCreated({ tenantId, conversation });
    const entityId = link?.entity_id;
    if (!entityId) return null;
    return this.entityService.linkEntity({ tenantId, entityId, sourceType: 'message', sourceId: messageId, confidence: 0.9 });
  }

  async linkTicketCreated({ tenantId, ticket }) {
    if (!ticket?.id) return null;
    const contactPhone = ticket.phoneNumber || ticket.phone_number || ticket.context?.phone || ticket.sessionId || ticket.session_id;
    const link = await this.entityService.linkSourceToEntity({
      tenantId,
      sourceType: 'ticket',
      sourceId: ticket.id,
      confidence: 0.86,
      contact: { phone: contactPhone, name: ticket.context?.name || contactPhone || ticket.id, refId: ticket.id },
    });
    const entityId = link?.entity_id;
    const conversationId = ticket.conversationId || ticket.conversation_id;
    if (entityId && conversationId) {
      await this.entityService.linkEntity({ tenantId, entityId, sourceType: 'conversation', sourceId: conversationId, confidence: 0.92 });
    }
    return link;
  }

  async linkGeneric({ tenantId, entityId, sourceType, sourceId, confidence = 1 }) {
    return this.entityService.linkEntity({ tenantId, entityId, sourceType: safeString(sourceType), sourceId: safeString(sourceId), confidence });
  }
}

module.exports = WorkspaceLinkAutomationService;

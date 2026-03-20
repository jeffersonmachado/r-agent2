'use strict';

function buildTicketRouteContext(deps) {
  return {
    requireAuth: deps.requireAuth,
    requirePermission: deps.requirePermission,
    sendJson: deps.sendJson,
    badRequest: deps.badRequest,
    hasJsonContentType: deps.hasJsonContentType,
    parseJsonBody: deps.parseJsonBody,
    logger: deps.logger,
    logAction: deps.logAction,
    createTicket: deps.createTicket,
    getTicket: deps.getTicket,
    getTicketBySession: deps.getTicketBySession,
    closeTicket: deps.closeTicket,
    listAllTickets: deps.listAllTickets,
    listQueues: deps.listQueues,
    getMetrics: deps.getMetrics,
    addAgentMessage: deps.addAgentMessage,
    updateOutboundMessageMeta: deps.updateOutboundMessageMeta,
    markMessagesAsRead: deps.markMessagesAsRead,
    getTicketMessages: deps.getTicketMessages,
    canAccessTicket: deps.canAccessTicket,
    canModifyTicket: deps.canModifyTicket,
    assignTicket: deps.assignTicket,
    triggerWebhooks: deps.triggerWebhooks,
    emitEvent: deps.emitEvent,
    outboundQueueService: deps.outboundQueueService,
    listConversationMessages: deps.listConversationMessages,
    takeOverTicket: deps.takeOverTicket,
    returnTicketToBot: deps.returnTicketToBot,
    pauseTicket: deps.pauseTicket,
    resumeHumanTicket: deps.resumeHumanTicket,
    autoAssignTicket: deps.autoAssignTicket,
    closeReasonsService: deps.closeReasonsService,
    ticketInsightService: deps.ticketInsightService,
  };
}

module.exports = {
  buildTicketRouteContext,
};

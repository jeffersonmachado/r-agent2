'use strict';

/**
 * Composition root do domínio Ticket.
 *
 * Concentra toda a lógica de montagem das dependências do Express router de tickets
 * e do contexto compartilhado historicamente usado pelo routing de platform.
 *
 * Antes: buildTicketRouteDeps() e createTicketRoutes inline em api/server.js.
 * Agora: server.js apenas importa e chama as funções exportadas aqui.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { logAction } = require('../../services/auditService');
const { canAccessTicket, canModifyTicket } = require('../../services/rbacService');
const {
  getTicket,
  getTicketBySession,
  assignTicket,
  closeTicket,
  listAllTickets,
  listQueues,
  getMetrics,
  addAgentMessage,
  updateOutboundMessageMeta,
  markMessagesAsRead,
  getTicketMessages,
  createTicket,
} = require('../../services/queueService');
const { triggerWebhooks } = require('../../services/webhookService');
const { emitEvent } = require('../../services/websocketService');
const outboundQueueService = require('../../services/outboundQueueService');
const { listConversationMessages } = require('../../services/channelConversationService');
const {
  takeOver: takeOverTicket,
  returnToBot: returnTicketToBot,
  setPaused: pauseTicket,
  resumeHuman: resumeHumanTicket,
} = require('../../services/handoverService');
const { autoAssign: autoAssignTicket } = require('../../services/assignmentService');
const closeReasonsService = require('../../services/closeReasonsService');
const ticketInsightService = require('../../services/ticketInsightService');
const { buildTicketRouteContext } = require('../../routing/contextBuilders/buildTicketRouteContext');
const { createTicketRoutes } = require('../../modules/ticket/routes');

/**
 * Monta o contexto de dependências para as rotas de ticket.
 * Usado por:
 *  - createTicketExpressRouter() (router moderno)
 *  - buildPlatformRoutingContext (residual) via ticketRouteContext
 *
 * @returns {object}
 */
function buildTicketRouteDeps() {
  return buildTicketRouteContext({
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    createTicket,
    getTicket,
    getTicketBySession,
    closeTicket,
    listAllTickets,
    listQueues,
    getMetrics,
    addAgentMessage,
    updateOutboundMessageMeta,
    markMessagesAsRead,
    getTicketMessages,
    canAccessTicket,
    canModifyTicket,
    assignTicket,
    triggerWebhooks,
    emitEvent,
    outboundQueueService,
    listConversationMessages,
    takeOverTicket,
    returnTicketToBot,
    pauseTicket,
    resumeHumanTicket,
    autoAssignTicket,
    closeReasonsService,
    ticketInsightService,
  });
}

/**
 * Cria o Express router do domínio Ticket.
 *
 * @returns {express.Router}
 */
function createTicketExpressRouter() {
  return createTicketRoutes({
    buildDeps: () => buildTicketRouteDeps(),
  });
}

module.exports = {
  buildTicketRouteDeps,
  createTicketExpressRouter,
};

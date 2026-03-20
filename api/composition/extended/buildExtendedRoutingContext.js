const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkRateLimit } = require('../../../infra/rate-limit');
const {
  requireAuth,
  requirePermission,
} = require('../../middleware/auth');
const {
  getRoleDefinitions,
  createRole,
  listPermissions,
  canAccessTicket,
  canModifyTicket,
} = require('../../services/rbacService');
const {
  logAction,
} = require('../../services/auditService');
const {
  getTicket,
  getTicketBySession,
  assignTicket,
  listAllTickets,
  transferTicket,
  addTicketNote,
} = require('../../services/queueService');
const {
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics,
} = require('../../services/qaService');
const {
  verifyWebhook,
} = require('../../services/whatsappService');
const {
  processWhatsAppMessage,
} = require('../../services/messageProcessor');
const {
  verifyMessengerWebhook,
  sendMessengerMessage,
  sendMessengerButtons,
} = require('../../services/messengerService');
const {
  verifyInstagramWebhook,
  sendInstagramMessage,
  sendInstagramMedia,
} = require('../../services/instagramService');
const {
  getAvailableEvents,
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
} = require('../../services/webhookService');
const {
  getSupervisorMetrics,
  getSupervisorAgentStatus,
  getSupervisorQueueStatus,
} = require('../../services/supervisorService');
const {
  getGeneralMetrics,
} = require('../../services/analyticsService');
const {
  scrapeUrl,
  scrapeUrls,
} = require('../../services/webScrapingService');
const {
  extractKeywords: nlpExtractKeywords,
  analyzeText: nlpAnalyzeText,
} = require('../../services/nlpService');
const {
  extractSemanticContext,
} = require('../../services/semanticContextService');
const {
  isSuperAdmin,
} = require('../../services/superAdminService');
const {
  getAgent,
  updateAgent,
} = require('../../services/authService');
const {
  emitEvent,
} = require('../../services/websocketService');
const {
  resolveOrCreateTicketFromIncomingMessage,
  appendTicketMessage,
} = require('../../services/conversationTicketLinkService');
const {
  autoAssign: autoAssignTicket,
} = require('../../services/assignmentService');
const {
  parseMultipartFormData,
} = require('../../utils/multipartParser');
const {
  sendApiError,
  buildApiError,
} = require('../../utils/apiError');
const {
  parseJsonBody,
  setCorsHeaders,
  sendJson,
  badRequest,
  hasJsonContentType,
} = require('../../express/httpHelpers');
const scheduleService = require('../../services/scheduleService');
const logger = require('../../utils/logger');
const channelNormalizationService = require('../../services/channelNormalizationService');
const channelGatewayService = require('../../services/channelGatewayService');
const { buildRagRouteDeps } = require('../rag');

function getRequestMethod(req) {
  return (req.method || 'GET').toUpperCase();
}

function getRequestPathname(req) {
  if (typeof req.path === 'string' && req.path) {
    return req.path;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  return url.pathname;
}

function createBuildExtendedRoutingContext(localDeps = {}) {
  const {
    requireTenant,
    flows,
    sessionEvents,
    saveSessionEventsToFile,
  } = localDeps;

  return function buildExtendedRoutingContext(req, res) {
    return {
      req,
      res,
      method: getRequestMethod(req),
      pathname: getRequestPathname(req),
      requireAuth,
      requirePermission,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      isSuperAdmin,
      logAction,
      logger,
      setCorsHeaders,
      sendApiError,
      buildApiError,
      scrapeUrl,
      scrapeUrls,
      getAvailableEvents,
      listWebhooks,
      getWebhook,
      createWebhook,
      updateWebhook,
      deleteWebhook,
      path,
      fs,
      crypto,
      getLatestQaResult,
      getQaHistory,
      getQaStatistics,
      getQaResultById,
      runQaManual,
      requireTenant,
      parseMultipartFormData,
      getTicket,
      getTicketBySession,
      listAllTickets,
      canAccessTicket,
      canModifyTicket,
      assignTicket,
      transferTicket,
      addTicketNote,
      triggerWebhooks,
      emitEvent,
      scheduleService,
      extractSemanticContext,
      nlpExtractKeywords,
      nlpAnalyzeText,
      checkRateLimit,
      getRoleDefinitions,
      createRole,
      listPermissions,
      getAgent,
      updateAgent,
      getSupervisorMetrics,
      getGeneralMetrics,
      getSupervisorAgentStatus,
      getSupervisorQueueStatus,
      verifyWebhook,
      processWhatsAppMessage,
      verifyMessengerWebhook,
      sendMessengerMessage,
      sendMessengerButtons,
      verifyInstagramWebhook,
      sendInstagramMessage,
      sendInstagramMedia,
      channelNormalizationService,
      channelGatewayService,
      resolveOrCreateTicketFromIncomingMessage,
      appendTicketMessage,
      autoAssignTicket,
      flows,
      sessionEvents,
      saveSessionEventsToFile,
      ragRouteContext: buildRagRouteDeps(),
    };
  };
}

module.exports = {
  createBuildExtendedRoutingContext,
};

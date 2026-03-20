const crypto = require('crypto');
const { validateFlow } = require('../../../engine/validator');
const { checkRateLimit } = require('../../../infra/rate-limit');
const { validateVoiceFlow } = require('../../utils/voiceFlowValidator');
const {
  requireAuth,
  requirePermission,
} = require('../../middleware/auth');
const {
  canAccessTicket,
  canModifyTicket,
} = require('../../services/rbacService');
const {
  logAction,
} = require('../../services/auditService');
const {
  listQueue,
  listQueues,
  createQueue,
  deleteQueue,
  getQueueInfo,
  createTicket,
  getTicket,
  getTicketBySession,
  assignTicket,
  closeTicket,
  listAllTickets,
  getMetrics,
  addAgentMessage,
  updateOutboundMessageMeta,
  markMessagesAsRead,
  getTicketMessages,
} = require('../../services/queueService');
const {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
} = require('../../services/departmentsService');
const {
  exportTicketsCSV,
  exportMetricsCSV,
  exportConversationsJSON,
  exportFullReportJSON,
} = require('../../services/exportService');
const {
  suggestResponse,
  rewriteMessage,
  rewriteMultipleMessages,
} = require('../../services/aiSuggestionService');
const {
  transcribeAudio,
} = require('../../services/audioTranscriptionService');
const {
  getAllTags,
  getAllCategories,
  filterTickets,
  addTagToTicket,
  removeTagFromTicket,
  setTicketCategory,
  getSegmentationStats,
} = require('../../services/segmentationService');
const {
  sendTemplateMessage,
  listTemplates,
  createTemplate,
  getTemplate,
} = require('../../services/whatsappTemplateService');
const {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  reindexDocument,
  reindexAllNotIndexed,
  getDocumentsStats,
} = require('../../services/ragDocumentsService');
const {
  getAIConfig,
  saveAIConfig,
  saveAICredentials,
  getDecryptedAPIKey,
} = require('../../services/tenantAIService');
const {
  initializeAiProviders,
} = require('../../services/aiProviderService');
const {
  isSuperAdmin,
} = require('../../services/superAdminService');
const {
  triggerWebhooks,
} = require('../../services/webhookService');
const {
  emitEvent,
} = require('../../services/websocketService');
const {
  listConversationMessages,
} = require('../../services/channelConversationService');
const {
  takeOver: takeOverTicket,
  returnToBot: returnTicketToBot,
  setPaused: pauseTicket,
  resumeHuman: resumeHumanTicket,
} = require('../../services/handoverService');
const {
  autoAssign: autoAssignTicket,
} = require('../../services/assignmentService');
const {
  parseJsonBody,
  setCorsHeaders,
  sendJson,
  badRequest,
  hasJsonContentType,
} = require('../../express/httpHelpers');
const { parseMultipartFormData } = require('../../utils/multipartParser');
const logger = require('../../utils/logger');
const outboundQueueService = require('../../services/outboundQueueService');
const queueDefinitionService = require('../../services/queueDefinitionService');
const closeReasonsService = require('../../services/closeReasonsService');
const ticketInsightService = require('../../services/ticketInsightService');
const flowTemplateMarketplaceService = require('../../services/flowTemplateMarketplaceService');
const ragService = require('../../services/ragService');
const ragDocumentsService = require('../../services/ragDocumentsService');
const ragDeduplicationService = require('../../services/ragDeduplicationService');
const { extractTextFromFile } = require('../../services/fileExtractionService');
const { isValidExecutionId } = require('../../middleware/requireExecutionId');
const { createPipelineWs } = require('../../ws/pipelineEmitter');
const { emitPipelineStage } = require('../../ws/emitPipelineStage');
const { buildTicketRouteDeps } = require('../ticket');

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

function createBuildPlatformRoutingContext(localDeps = {}) {
  const {
    requireTenant,
    validateFlowStructure,
    ensureFlowHasMeta,
    persistFlowBestEffort,
    flows,
    detectProcessManager,
  } = localDeps;

  return function buildPlatformRoutingContext(req, res) {
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
      logger,
      logAction,
      listQueues,
      createQueue,
      getQueueInfo,
      deleteQueue,
      listQueue,
      canAccessTicket,
      queueDefinitionService,
      createTicket,
      getTicket,
      getTicketBySession,
      closeTicket,
      listAllTickets,
      getMetrics,
      addAgentMessage,
      updateOutboundMessageMeta,
      markMessagesAsRead,
      getTicketMessages,
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
      requireTenant,
      crypto,
      flowTemplateMarketplaceService,
      validateFlowStructure,
      validateFlow,
      validateVoiceFlow,
      ensureFlowHasMeta,
      persistFlowBestEffort,
      flows,
      getAIConfig,
      saveAIConfig,
      saveAICredentials,
      getDecryptedAPIKey,
      initializeAiProviders,
      isSuperAdmin,
      setCorsHeaders,
      detectProcessManager,
      listDepartments,
      getDepartment,
      createDepartment,
      updateDepartment,
      deleteDepartment,
      addAgentToDepartment,
      removeAgentFromDepartment,
      exportTicketsCSV,
      exportMetricsCSV,
      exportConversationsJSON,
      exportFullReportJSON,
      suggestResponse,
      rewriteMessage,
      rewriteMultipleMessages,
      transcribeAudio,
      getAllTags,
      getAllCategories,
      filterTickets,
      getSegmentationStats,
      addTagToTicket,
      removeTagFromTicket,
      setTicketCategory,
      listTemplates,
      getTemplate,
      createTemplate,
      sendTemplateMessage,
      parseMultipartFormData,
      listDocuments,
      getDocument,
      createDocument,
      updateDocument,
      deleteDocument,
      reindexDocument,
      reindexAllNotIndexed,
      getDocumentsStats,
      ragService,
      ragDocumentsService,
      ragDeduplicationService,
      extractTextFromFile,
      isValidExecutionId,
      createPipelineWs,
      emitPipelineStage,
      checkRateLimit,
      ticketRouteContext: buildTicketRouteDeps(),
    };
  };
}

module.exports = {
  createBuildPlatformRoutingContext,
};

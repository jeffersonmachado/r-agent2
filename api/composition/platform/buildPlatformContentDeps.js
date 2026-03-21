'use strict';

const { validateFlow } = require('../../../engine/validator');
const { validateVoiceFlow } = require('../../utils/voiceFlowValidator');
const {
  canModifyTicket,
  canAccessTicket,
} = require('../../services/rbacService');
const {
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
  suggestResponse,
  rewriteMessage,
  rewriteMultipleMessages,
} = require('../../services/aiSuggestionService');
const { transcribeAudio } = require('../../services/audioTranscriptionService');
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
const { triggerWebhooks } = require('../../services/webhookService');
const { emitEvent } = require('../../services/websocketService');
const { listConversationMessages } = require('../../services/channelConversationService');
const {
  takeOver: takeOverTicket,
  returnToBot: returnTicketToBot,
  setPaused: pauseTicket,
  resumeHuman: resumeHumanTicket,
} = require('../../services/handoverService');
const { autoAssign: autoAssignTicket } = require('../../services/assignmentService');
const { parseMultipartFormData } = require('../../utils/multipartParser');
const outboundQueueService = require('../../services/outboundQueueService');
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

function buildPlatformContentDeps(localDeps) {
  const {
    validateFlowStructure,
    ensureFlowHasMeta,
    persistFlowBestEffort,
    flows,
  } = localDeps;

  return {
    canAccessTicket,
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
    flowTemplateMarketplaceService,
    validateFlowStructure,
    validateFlow,
    validateVoiceFlow,
    ensureFlowHasMeta,
    persistFlowBestEffort,
    flows,
    suggestResponse,
    rewriteMessage,
    rewriteMultipleMessages,
    transcribeAudio,
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
  };
}

module.exports = {
  buildPlatformContentDeps,
};

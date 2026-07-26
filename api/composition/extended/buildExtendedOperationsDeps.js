'use strict';

const {
  getRoleDefinitions,
  createRole,
  listPermissions,
  canAccessTicket,
  canModifyTicket,
} = require('../../services/rbacService');
const {
  createTicket,
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
  getSupervisorMetrics,
  getSupervisorAgentStatus,
  getSupervisorQueueStatus,
} = require('../../services/supervisorService');
const { getGeneralMetrics } = require('../../services/analyticsService');
const {
  extractKeywords: nlpExtractKeywords,
  analyzeText: nlpAnalyzeText,
} = require('../../services/nlpService');
const { extractSemanticContext } = require('../../services/semanticContextService');
const { getAgent, updateAgent } = require('../../services/authService');
const { emitEvent } = require('../../services/websocketService');
const scheduleService = require('../../services/scheduleService');
const { parseMultipartFormData } = require('../../utils/multipartParser');

function buildExtendedOperationsDeps() {
  return {
    getLatestQaResult,
    getQaHistory,
    getQaStatistics,
    getQaResultById,
    runQaManual,
    parseMultipartFormData,
    createTicket,
    getTicket,
    getTicketBySession,
    listAllTickets,
    canAccessTicket,
    canModifyTicket,
    assignTicket,
    transferTicket,
    addTicketNote,
    emitEvent,
    scheduleService,
    extractSemanticContext,
    nlpExtractKeywords,
    nlpAnalyzeText,
    getRoleDefinitions,
    createRole,
    listPermissions,
    getAgent,
    updateAgent,
    getSupervisorMetrics,
    getGeneralMetrics,
    getSupervisorAgentStatus,
    getSupervisorQueueStatus,
  };
}

module.exports = {
  buildExtendedOperationsDeps,
};

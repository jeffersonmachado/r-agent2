'use strict';

const { canAccessTicket } = require('../../services/rbacService');
const {
  listQueue,
  listQueues,
  createQueue,
  deleteQueue,
  getQueueInfo,
  getTicket,
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
const queueDefinitionService = require('../../services/queueDefinitionService');
const {
  getAIConfig,
  saveAIConfig,
  saveAICredentials,
  getDecryptedAPIKey,
} = require('../../services/tenantAIService');
const { initializeAiProviders } = require('../../services/aiProviderService');
const { isSuperAdmin } = require('../../services/superAdminService');

function buildPlatformAdminDeps() {
  return {
    listQueues,
    createQueue,
    getQueueInfo,
    deleteQueue,
    listQueue,
    canAccessTicket,
    queueDefinitionService,
    getTicket,
    getAIConfig,
    saveAIConfig,
    saveAICredentials,
    getDecryptedAPIKey,
    initializeAiProviders,
    isSuperAdmin,
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
  };
}

module.exports = {
  buildPlatformAdminDeps,
};

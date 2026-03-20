'use strict';

function parseCreatePayload(body) {
  return {
    id: body?.id || null,
    name: body && body.name ? String(body.name).trim() : '',
    description: body?.description || '',
    status: body?.status || 'draft',
    definition: body?.definition || {},
  };
}

function validateCreatePayload(payload) {
  if (!payload.name) {
    return { valid: false, message: 'name é obrigatório' };
  }

  return { valid: true };
}

function createAutomationService({ automationRuntime }) {
  return {
    parseCreatePayload,
    validateCreatePayload,

    async listAutomations(tenantId) {
      return automationRuntime.listAutomations(tenantId);
    },

    async saveAutomation(tenantId, payload) {
      return automationRuntime.upsertAutomation(tenantId, payload);
    },

    async publishAutomation(tenantId, automationId) {
      return automationRuntime.publishAutomation(tenantId, automationId);
    },

    async runAutomation(tenantId, automationId) {
      return automationRuntime.runAutomation(tenantId, automationId);
    },
  };
}

module.exports = {
  createAutomationService,
};

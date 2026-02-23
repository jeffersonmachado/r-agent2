'use strict';

/**
 * CRM Service Webhook Interceptor
 * Wraps crmService functions to automatically trigger webhooks on mutations
 * Follows the decorator pattern to enhance existing service methods
 */

const webhookService = require('./webhookService');

/**
 * Map CRM event types to webhook events
 */
const eventToWebhookMap = {
  CrmAccountUpserted: (payload) => ({
    event: 'account.upserted',
    data: payload,
  }),
  CrmContactUpserted: (payload) => ({
    event: 'contact.upserted',
    data: payload,
  }),
  CrmLeadUpserted: (payload) => ({
    event: 'lead.upserted',
    data: payload,
  }),
  CrmPipelineUpserted: (payload) => ({
    event: 'pipeline.upserted',
    data: payload,
  }),
  CrmOpportunityUpserted: (payload) => ({
    event: 'opportunity.upserted',
    data: payload,
  }),
  CrmOpportunityStageChanged: (payload) => ({
    event: 'opportunity.stage_changed',
    data: payload,
  }),
  CrmActivityLogged: (payload) => ({
    event: 'activity.logged',
    data: payload,
  }),
};

/**
 * Wraps crmService result to trigger webhook after successful operation
 */
async function withWebhookTrigger(tenantId, result, eventType, sequelize) {
  if (!result || !result.ok) {
    return result; // Don't trigger webhook on errors
  }

  try {
    const webhookConfig = eventToWebhookMap[eventType];
    if (webhookConfig) {
      const webhookData = webhookConfig(result);
      await webhookService.triggerWebhookEvent(
        sequelize,
        tenantId,
        webhookData.event,
        webhookData.data,
      );
    }
  } catch (err) {
    // Log but don't fail the operation if webhook trigger fails
    console.error('Webhook trigger failed:', err.message);
  }

  return result;
}

/**
 * Creates wrapped version of crmService with automatic webhook triggers
 */
function createCrmServiceWithWebhooks(crmService, sequelize) {
  return {
    listAccounts: (args) => crmService.listAccounts(args),

    upsertAccount: async (args) => {
      const result = await crmService.upsertAccount(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmAccountUpserted', sequelize);
    },

    listContacts: (args) => crmService.listContacts(args),

    upsertContact: async (args) => {
      const result = await crmService.upsertContact(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmContactUpserted', sequelize);
    },

    listLeads: (args) => crmService.listLeads(args),

    upsertLead: async (args) => {
      const result = await crmService.upsertLead(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmLeadUpserted', sequelize);
    },

    listPipelines: (args) => crmService.listPipelines(args),

    upsertPipeline: async (args) => {
      const result = await crmService.upsertPipeline(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmPipelineUpserted', sequelize);
    },

    listOpportunities: (args) => crmService.listOpportunities(args),

    upsertOpportunity: async (args) => {
      const result = await crmService.upsertOpportunity(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmOpportunityUpserted', sequelize);
    },

    moveOpportunityStage: async (args) => {
      const result = await crmService.moveOpportunityStage(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmOpportunityStageChanged', sequelize);
    },

    listActivities: (args) => crmService.listActivities(args),

    logActivity: async (args) => {
      const result = await crmService.logActivity(args);
      return withWebhookTrigger(args.tenantId, result, 'CrmActivityLogged', sequelize);
    },

    getUnifiedTimeline: (args) => crmService.getUnifiedTimeline(args),
  };
}

module.exports = {
  createCrmServiceWithWebhooks,
  eventToWebhookMap,
};

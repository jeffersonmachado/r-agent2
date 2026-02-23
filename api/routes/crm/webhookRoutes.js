'use strict';

/**
 * Webhook and Integration Routes
 * Mounts webhook and external integration endpoints
 */

const express = require('express');
const router = express.Router();

const webhookHandlers = require('../../handlers/crm/webhookHandlers');
const { requireCrmPermission, requireResourcePermission, logCrmAudit } = require('../../middleware/crmAuth');

/**
 * ============ WEBHOOK ROUTES ============
 */

// Register new webhook
router.post('/webhooks', requireCrmPermission('crm:webhooks:write'), async (req, res, next) => {
  await webhookHandlers.registerWebhook(req, res);
  logCrmAudit('webhook_created', 'webhook')(req, res, next);
});

// List webhooks
router.get('/webhooks', requireCrmPermission('crm:webhooks:read'), webhookHandlers.listWebhooks);

// Update webhook
router.put('/webhooks/:webhookId', requireCrmPermission('crm:webhooks:write'), async (req, res, next) => {
  await webhookHandlers.updateWebhook(req, res);
  logCrmAudit('webhook_updated', 'webhook')(req, res, next);
});

// Delete webhook
router.delete('/webhooks/:webhookId', requireCrmPermission('crm:webhooks:delete'), async (req, res, next) => {
  await webhookHandlers.deleteWebhook(req, res);
  logCrmAudit('webhook_deleted', 'webhook')(req, res, next);
});

// Test webhook delivery
router.post('/webhooks/:webhookId/test', requireCrmPermission('crm:webhooks:write'), webhookHandlers.testWebhook);

// Get webhook queue status
router.get('/webhooks/:webhookId/queue', requireCrmPermission('crm:webhooks:read'), webhookHandlers.getQueueStatus);

/**
 * ============ INTEGRATION ROUTES ============
 */

// Create external integration
router.post('/integrations', requireCrmPermission('crm:integrations:write'), async (req, res, next) => {
  await webhookHandlers.createIntegration(req, res);
  logCrmAudit('integration_created', 'integration')(req, res, next);
});

// List integrations
router.get('/integrations', requireCrmPermission('crm:integrations:read'), webhookHandlers.listIntegrations);

// Delete integration
router.delete('/integrations/:integrationId', requireCrmPermission('crm:integrations:delete'), async (req, res, next) => {
  await webhookHandlers.deleteIntegration(req, res);
  logCrmAudit('integration_deleted', 'integration')(req, res, next);
});

// Trigger sync for integration
router.post('/integrations/:integrationId/sync', requireCrmPermission('crm:integrations:write'), async (req, res, next) => {
  await webhookHandlers.syncIntegrationData(req, res);
  logCrmAudit('integration_synced', 'integration')(req, res, next);
});

module.exports = router;

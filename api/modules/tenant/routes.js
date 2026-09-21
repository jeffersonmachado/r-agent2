const express = require('express');

function requireJsonContentType(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    res.status(400).json({ error: 'bad_request', message: 'Content-Type deve ser application/json' });
    return;
  }

  next();
}

function createTenantRoutes({ controller }) {
  const router = express.Router();
  const jsonParser = express.json({ limit: '1mb' });

  router.post('/generate-by-ai', requireJsonContentType, jsonParser, controller.generateByAi);
  router.get('/', controller.listTenants);
  router.post('/', requireJsonContentType, jsonParser, controller.createTenant);
  router.put('/current/ai-config', requireJsonContentType, jsonParser, controller.updateCurrentTenantAiConfig);
  router.put('/current/ai-credentials', requireJsonContentType, jsonParser, controller.saveCurrentTenantAiCredentials);
  router.put('/:tenantId/ai-credentials', requireJsonContentType, jsonParser, controller.saveTenantAiCredentials);
  router.post('/:tenantId/ai-credentials/test', requireJsonContentType, jsonParser, controller.testTenantAiCredentials);
  router.get('/:tenantId/ai-provider-status', controller.getAiProviderStatus);
  router.get('/:tenantId/ai-config', controller.getAiConfig);
  router.get('/:tenantId/context', controller.getTenantContext);
  router.put('/:tenantId/context', requireJsonContentType, jsonParser, controller.updateTenantContext);
  router.get('/:tenantId/usage', controller.getTenantUsage);
  router.get('/:tenantId/plan-usage', controller.getPlanUsage);
  router.post('/:tenantId/suspend', controller.suspendTenant);
  router.post('/:tenantId/reactivate', controller.reactivateTenant);
  router.post('/:tenantId/change-plan', requireJsonContentType, jsonParser, controller.changePlan);
  router.get('/:tenantId', controller.getTenant);
  router.put('/:tenantId', requireJsonContentType, jsonParser, controller.updateTenant);
  router.delete('/:tenantId', controller.deleteTenant);

  return router;
}

module.exports = {
  createTenantRoutes,
};

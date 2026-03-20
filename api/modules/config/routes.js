'use strict';

const express = require('express');
const { createConfigService } = require('./service');
const { createConfigController } = require('./controller');

function createConfigRoutes({ buildDeps }) {
  const router = express.Router();

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createConfigService({ deps });
    return createConfigController({ service, deps });
  }

  router.get('/config', async (req, res, next) => {
    const handled = await controllerFor(req, res).getConfig(req, res);
    if (handled === false && !res.writableEnded) {
      next();
    }
  });
  router.get('/contracts/rag/question-generation.rules.json', (req, res) => controllerFor(req, res).getQuestionGenerationRules(req, res));
  router.get('/api/data/rag_question_generation_rules.json', (req, res) => controllerFor(req, res).getQuestionGenerationRules(req, res));
  router.get('/tenants/current/ai-config', (req, res) => controllerFor(req, res).getCurrentTenantAiConfig(req, res));
  router.put('/tenants/current/ai-config', (req, res) => controllerFor(req, res).saveCurrentTenantAiConfig(req, res));
  router.put('/tenants/current/ai-credentials', (req, res) => controllerFor(req, res).saveCurrentTenantAiCredentials(req, res));
  router.post('/tenants/:tenantKey/ai-credentials/test', (req, res) => controllerFor(req, res).testTenantAiCredentials(req, res));
  router.put('/config', (req, res) => controllerFor(req, res).updateConfig(req, res));
  router.get('/server/process-manager', (req, res) => controllerFor(req, res).getProcessManager(req, res));
  router.post('/config/validate-provider-token', (req, res) => controllerFor(req, res).validateProviderToken(req, res));
  router.post('/config/validate-redis', (req, res) => controllerFor(req, res).validateRedis(req, res));
  router.post('/server/restart', (req, res) => controllerFor(req, res).restartServer(req, res));

  return router;
}

module.exports = {
  createConfigRoutes,
};

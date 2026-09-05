'use strict';

const express = require('express');
const { createInboxService } = require('./service');
const { createInboxController } = require('./controller');
const { requireTenantCapability } = require('../../middleware/requireTenantCapability');

function createInboxRoutes({ buildDeps }) {
  const router = express.Router();

  const caseManagementCapability = requireTenantCapability('caseManagement');

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createInboxService(deps);

    return createInboxController({ service, deps });
  }

  router.get('/inbox/conversations', (req, res) => controllerFor(req, res).list(req, res));
  router.get('/inbox/conversations/:conversationId', (req, res) => controllerFor(req, res).get(req, res));
  router.post('/inbox/conversations/:conversationId/reply', (req, res) => controllerFor(req, res).reply(req, res));
  router.post('/inbox/conversations/:conversationId/assign', (req, res) => controllerFor(req, res).assign(req, res));
  router.post('/inbox/conversations/:conversationId/transfer', (req, res) => controllerFor(req, res).transfer(req, res));
  router.post('/inbox/conversations/:conversationId/status', (req, res) => controllerFor(req, res).setStatus(req, res));
  router.post('/inbox/conversations/:conversationId/notes', (req, res) => controllerFor(req, res).notes(req, res));
  router.post(
    '/inbox/conversations/:conversationId/case',
    caseManagementCapability,
    (req, res) => controllerFor(req, res).createCase(req, res),
  );

  return router;
}

module.exports = {
  createInboxRoutes,
};

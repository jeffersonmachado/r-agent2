'use strict';

const express = require('express');
const marketingService = require('../../services/marketing/marketingService');
const marketingLinkService = require('../../services/marketing/marketingLinkService');
const { createMarketingService } = require('./service');
const { createMarketingController } = require('./controller');

function createMarketingRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createMarketingService({ marketingService, marketingLinkService });

  function controllerFor(req, res) {
    return createMarketingController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/api/marketing/forms', (req, res) => controllerFor(req, res).listForms(req, res));
  router.post('/api/marketing/forms', (req, res) => controllerFor(req, res).upsertForm(req, res));
  router.get('/api/marketing/links', (req, res) => controllerFor(req, res).listLinks(req, res));
  router.post('/api/marketing/links', (req, res) => controllerFor(req, res).createLink(req, res));
  router.get('/api/marketing/leads', (req, res) => controllerFor(req, res).listLeads(req, res));
  router.get('/api/marketing/leads/stats', (req, res) => controllerFor(req, res).leadStats(req, res));
  router.get('/api/marketing/scoring-rules', (req, res) => controllerFor(req, res).listScoringRules(req, res));
  router.post('/api/marketing/scoring-rules', (req, res) => controllerFor(req, res).upsertScoringRule(req, res));
  router.post('/api/marketing/email-campaigns', (req, res) => controllerFor(req, res).createEmailCampaign(req, res));
  router.post('/api/marketing/email-campaigns/:campaignId/send', (req, res) => controllerFor(req, res).sendEmailCampaignNow(req, res));

  return router;
}

module.exports = {
  createMarketingRoutes,
};

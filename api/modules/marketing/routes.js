'use strict';

const express = require('express');
const marketingService = require('../../services/marketing/marketingService');
const marketingLinkService = require('../../services/marketing/marketingLinkService');
const googleAdsConversionService = require('../../services/marketing/googleAdsConversionService');
const { createMarketingService } = require('./service');
const { createMarketingController } = require('./controller');

function createMarketingRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createMarketingService({ marketingService, marketingLinkService, googleAdsService: googleAdsConversionService });

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
  router.post('/api/marketing/leads', (req, res) => controllerFor(req, res).upsertLead(req, res));
  router.patch('/api/marketing/leads/:leadId', (req, res) => controllerFor(req, res).updateLead(req, res));
  router.get('/api/marketing/leads/stats', (req, res) => controllerFor(req, res).leadStats(req, res));
  router.get('/api/marketing/scoring-rules', (req, res) => controllerFor(req, res).listScoringRules(req, res));
  router.post('/api/marketing/scoring-rules', (req, res) => controllerFor(req, res).upsertScoringRule(req, res));
  router.get('/api/marketing/email-campaigns', (req, res) => controllerFor(req, res).listEmailCampaigns(req, res));
  router.post('/api/marketing/email-campaigns', (req, res) => controllerFor(req, res).createEmailCampaign(req, res));
  router.post('/api/marketing/email-campaigns/:campaignId/send', (req, res) => controllerFor(req, res).sendEmailCampaignNow(req, res));
  router.get('/api/marketing/google-ads/settings', (req, res) => controllerFor(req, res).getGoogleAdsSettings(req, res));
  router.post('/api/marketing/google-ads/settings', (req, res) => controllerFor(req, res).upsertGoogleAdsSettings(req, res));
  router.get('/api/marketing/google-ads/conversions', (req, res) => controllerFor(req, res).listGoogleAdsConversions(req, res));
  router.post('/api/marketing/google-ads/conversions', (req, res) => controllerFor(req, res).createGoogleAdsConversion(req, res));
  router.post('/api/marketing/google-ads/conversions/upload', (req, res) => controllerFor(req, res).uploadGoogleAdsConversions(req, res));
  router.post('/api/marketing/google-ads/keywords/sync', (req, res) => controllerFor(req, res).syncGoogleAdsKeywordPerformance(req, res));
  router.get('/api/marketing/google-ads/keywords/performance', (req, res) => controllerFor(req, res).listGoogleAdsKeywordPerformance(req, res));
  router.get('/api/marketing/google-ads/search-terms/performance', (req, res) => controllerFor(req, res).listGoogleAdsSearchTermPerformance(req, res));
  router.get('/api/marketing/google-ads/roi', (req, res) => controllerFor(req, res).getGoogleAdsRoiBreakdown(req, res));
  router.get('/api/marketing/google-ads/attribution-exceptions', (req, res) => controllerFor(req, res).getGoogleAdsAttributionExceptions(req, res));
  router.post('/api/marketing/google-ads/keywords/analyze', (req, res) => controllerFor(req, res).analyzeGoogleAdsKeywords(req, res));
  router.post('/api/marketing/google-ads/keywords/actions/apply', (req, res) => controllerFor(req, res).applyGoogleAdsKeywordAction(req, res));
  router.post('/api/marketing/google-ads/recommendations/sync', (req, res) => controllerFor(req, res).syncGoogleAdsRecommendations(req, res));
  router.get('/api/marketing/google-ads/recommendations', (req, res) => controllerFor(req, res).listGoogleAdsRecommendations(req, res));
  router.put('/api/marketing/google-ads/recommendations/:recommendationId', (req, res) => controllerFor(req, res).updateGoogleAdsRecommendation(req, res));
  router.post('/api/marketing/google-ads/recommendations/:recommendationId/apply', (req, res) => controllerFor(req, res).applyGoogleAdsRecommendation(req, res));

  return router;
}

module.exports = {
  createMarketingRoutes,
};

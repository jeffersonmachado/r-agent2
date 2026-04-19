'use strict';

const googleAdsConversionService = require('../../services/marketing/googleAdsConversionService');
const googleAdsKeywordInsightService = require('../../services/marketing/googleAdsKeywordInsightService');
const googleAdsKeywordActionService = require('../../services/marketing/googleAdsKeywordActionService');
const googleAdsRecommendationService = require('../../services/marketing/googleAdsRecommendationService');
const googleAdsRoiService = require('../../services/marketing/googleAdsRoiService');
const googleAdsAttributionMonitorService = require('../../services/marketing/googleAdsAttributionMonitorService');

function parsePaging(urlString, defaults = { limit: 200, offset: 0 }) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  const limit = urlObj.searchParams.get('limit');
  const offset = urlObj.searchParams.get('offset');

  return {
    limit: limit != null ? Number(limit) : defaults.limit,
    offset: offset != null ? Number(offset) : defaults.offset,
  };
}

function createMarketingService({ marketingService, marketingLinkService, googleAdsService = googleAdsConversionService, googleAdsKeywordService = googleAdsKeywordInsightService, googleAdsKeywordActionSvc = googleAdsKeywordActionService, googleAdsRecommendationSvc = googleAdsRecommendationService, googleAdsRoiSvc = googleAdsRoiService, googleAdsAttributionMonitorSvc = googleAdsAttributionMonitorService }) {
  return {
    async listForms({ tenantId }) {
      return marketingService.listForms({ tenantId });
    },

    async upsertForm({ tenantId, body }) {
      return marketingService.upsertForm({
        tenantId,
        slug: body && body.slug ? String(body.slug).trim() : '',
        name: body && body.name ? String(body.name).trim() : '',
        fields: body && body.fields ? body.fields : {},
        landingHtml: body && body.landingHtml != null ? body.landingHtml : null,
        settings: body && body.settings ? body.settings : {},
        status: body && body.status ? String(body.status).trim() : 'active',
      });
    },

    async listLinks({ tenantId, url }) {
      const paging = parsePaging(url);
      return marketingLinkService.listLinks({ tenantId, ...paging });
    },

    async createLink({ tenantId, body }) {
      return marketingLinkService.createLink({
        tenantId,
        name: body && body.name ? String(body.name).trim() : null,
        targetUrl: body && body.targetUrl ? String(body.targetUrl).trim() : null,
        source: body && body.source ? String(body.source).trim() : null,
        campaign: body && body.campaign ? String(body.campaign).trim() : null,
        medium: body && body.medium ? String(body.medium).trim() : null,
        content: body && body.content ? String(body.content).trim() : null,
        term: body && body.term ? String(body.term).trim() : null,
        code: body && body.code ? String(body.code).trim() : null,
        status: body && body.status ? String(body.status).trim() : 'active',
        metadata: body && body.metadata ? body.metadata : {},
      });
    },

    async listLeads({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url);
      const stage = urlObj.searchParams.get('stage');
      const minScore = urlObj.searchParams.get('minScore');

      return marketingService.listLeads({
        tenantId,
        stage: stage ? String(stage) : null,
        minScore: minScore != null ? Number(minScore) : null,
        ...paging,
      });
    },

    async upsertLead({ tenantId, body }) {
      return marketingService.upsertLead({
        tenantId,
        email: body && body.email ? body.email : null,
        phone: body && body.phone ? body.phone : null,
        externalId: body && body.externalId ? body.externalId : (body && body.external_id ? body.external_id : null),
        name: body && body.name ? body.name : null,
        attributesPatch: body && body.attributes ? body.attributes : {},
        stage: body && body.stage ? body.stage : null,
        lastSeenAt: body && body.lastSeenAt ? body.lastSeenAt : null,
      });
    },

    async updateLead({ tenantId, leadId, body }) {
      return marketingService.updateLead({
        tenantId,
        leadId,
        stage: body && body.stage ? body.stage : null,
        name: body && body.name ? body.name : null,
        attributesPatch: body && body.attributes ? body.attributes : {},
        score: body && body.score != null ? Number(body.score) : null,
      });
    },

    async getLeadStats({ tenantId }) {
      return marketingService.getLeadStats({ tenantId });
    },

    async listScoringRules({ tenantId }) {
      return marketingService.listScoringRules({ tenantId });
    },

    async upsertScoringRule({ tenantId, body }) {
      return marketingService.upsertScoringRule({
        tenantId,
        id: body && body.id ? String(body.id).trim() : null,
        name: body && body.name ? String(body.name).trim() : null,
        enabled: body ? body.enabled !== false : true,
        eventType: body && body.eventType ? String(body.eventType).trim() : null,
        delta: body && body.delta != null ? Number(body.delta) : 0,
        conditions: body && body.conditions ? body.conditions : null,
      });
    },

    async createEmailCampaign({ tenantId, body }) {
      return marketingService.createEmailCampaign({
        tenantId,
        name: body && body.name ? String(body.name).trim() : null,
        subject: body && body.subject ? String(body.subject).trim() : null,
        bodyText: body && body.bodyText != null ? body.bodyText : null,
        bodyHtml: body && body.bodyHtml != null ? body.bodyHtml : null,
        minScore: body && body.minScore != null ? Number(body.minScore) : null,
      });
    },

    async listEmailCampaigns({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url);
      const status = urlObj.searchParams.get('status');
      return marketingService.listEmailCampaigns({
        tenantId,
        status: status ? String(status) : null,
        ...paging,
      });
    },

    async sendEmailCampaignNow({ tenantId, campaignId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');

      return marketingService.sendEmailCampaignNow({
        tenantId,
        campaignId,
        limit: limit != null ? Number(limit) : 2000,
      });
    },

    async getGoogleAdsSettings({ tenantId }) {
      return googleAdsService.getGoogleAdsSettings({ tenantId });
    },

    async upsertGoogleAdsSettings({ tenantId, body }) {
      return googleAdsService.upsertGoogleAdsSettings({ tenantId, value: body && typeof body === 'object' ? body : {} });
    },

    async listGoogleAdsConversions({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url, { limit: 100, offset: 0 });
      const status = urlObj.searchParams.get('status');
      return googleAdsService.listOfflineConversions({
        tenantId,
        status: status ? String(status) : null,
        ...paging,
      });
    },

    async createGoogleAdsConversion({ tenantId, body }) {
      return googleAdsService.registerOfflineConversion({
        tenantId,
        leadId: body && body.leadId ? String(body.leadId).trim() : null,
        clickId: body && body.clickId ? String(body.clickId).trim() : null,
        clickIdType: body && body.clickIdType ? String(body.clickIdType).trim() : null,
        conversionName: body && body.conversionName ? String(body.conversionName).trim() : null,
        conversionActionId: body && body.conversionActionId ? String(body.conversionActionId).trim() : null,
        conversionTime: body && body.conversionTime ? body.conversionTime : null,
        conversionValue: body && body.conversionValue != null ? body.conversionValue : null,
        currencyCode: body && body.currencyCode ? String(body.currencyCode).trim() : 'BRL',
        idempotencyKey: body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null,
        metadata: body && body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
    },

    async uploadGoogleAdsConversions({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');
      return googleAdsService.uploadPendingConversions({
        tenantId,
        limit: limit != null ? Number(limit) : 50,
      });
    },

    async syncGoogleAdsKeywordPerformance({ tenantId, body }) {
      return googleAdsKeywordService.syncKeywordPerformance({
        tenantId,
        startDate: body && body.startDate ? body.startDate : null,
        endDate: body && body.endDate ? body.endDate : null,
      });
    },

    async listGoogleAdsKeywordPerformance({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url, { limit: 100, offset: 0 });
      return googleAdsKeywordService.listKeywordPerformance({
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || null,
        endDate: urlObj.searchParams.get('endDate') || null,
        campaignId: urlObj.searchParams.get('campaignId') || null,
        adGroupId: urlObj.searchParams.get('adGroupId') || null,
        matchType: urlObj.searchParams.get('matchType') || null,
        sortBy: urlObj.searchParams.get('sortBy') || 'cost',
        sortOrder: urlObj.searchParams.get('sortOrder') || 'desc',
        ...paging,
      });
    },

    async listGoogleAdsSearchTermPerformance({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url, { limit: 100, offset: 0 });
      return googleAdsKeywordService.listSearchTermPerformance({
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || null,
        endDate: urlObj.searchParams.get('endDate') || null,
        campaignId: urlObj.searchParams.get('campaignId') || null,
        adGroupId: urlObj.searchParams.get('adGroupId') || null,
        sortBy: urlObj.searchParams.get('sortBy') || 'cost',
        sortOrder: urlObj.searchParams.get('sortOrder') || 'desc',
        ...paging,
      });
    },

    async analyzeGoogleAdsKeywords({ tenantId, body }) {
      return googleAdsKeywordService.analyzeKeywordPortfolio({
        tenantId,
        startDate: body && body.startDate ? body.startDate : null,
        endDate: body && body.endDate ? body.endDate : null,
        options: body && body.options && typeof body.options === 'object' ? body.options : {},
      });
    },

    async applyGoogleAdsKeywordAction({ tenantId, body }) {
      return googleAdsKeywordActionSvc.applyKeywordAction({
        tenantId,
        action: body && body.action ? String(body.action).trim() : null,
        payload: body && typeof body === 'object' ? body : {},
      });
    },

    async syncGoogleAdsRecommendations({ tenantId, body }) {
      return googleAdsRecommendationSvc.syncRecommendationsFromAnalysis({
        tenantId,
        startDate: body && body.startDate ? body.startDate : null,
        endDate: body && body.endDate ? body.endDate : null,
        options: body && body.options && typeof body.options === 'object' ? body.options : {},
      });
    },

    async listGoogleAdsRecommendations({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      return googleAdsRecommendationSvc.listRecommendations({
        tenantId,
        status: urlObj.searchParams.get('status') || null,
        limit: urlObj.searchParams.get('limit') != null ? Number(urlObj.searchParams.get('limit')) : 100,
      });
    },

    async updateGoogleAdsRecommendation({ tenantId, recommendationId, body }) {
      return googleAdsRecommendationSvc.updateRecommendationStatus({
        tenantId,
        recommendationId,
        status: body && body.status ? String(body.status).trim() : null,
        note: body && body.note ? String(body.note).trim() : null,
      });
    },

    async applyGoogleAdsRecommendation({ tenantId, recommendationId, body }) {
      return googleAdsRecommendationSvc.applyRecommendation({
        tenantId,
        recommendationId,
        dryRun: body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'dryRun') ? body.dryRun === true : null,
      });
    },

    async getGoogleAdsRoiBreakdown({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const paging = parsePaging(url, { limit: 100, offset: 0 });
      return googleAdsRoiSvc.getGoogleAdsRoiBreakdown({
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || null,
        endDate: urlObj.searchParams.get('endDate') || null,
        campaignId: urlObj.searchParams.get('campaignId') || null,
        adGroupId: urlObj.searchParams.get('adGroupId') || null,
        entity: urlObj.searchParams.get('entity') || 'campaign',
        sortBy: urlObj.searchParams.get('sortBy') || 'conversionValue',
        sortOrder: urlObj.searchParams.get('sortOrder') || 'desc',
        ...paging,
      });
    },

    async getGoogleAdsAttributionExceptions({ tenantId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      return googleAdsAttributionMonitorSvc.getOrderAttributionExceptions({
        tenantId,
        windowDays: urlObj.searchParams.get('windowDays') != null ? Number(urlObj.searchParams.get('windowDays')) : 7,
        limit: urlObj.searchParams.get('limit') != null ? Number(urlObj.searchParams.get('limit')) : 20,
      });
    },
  };
}

module.exports = {
  createMarketingService,
};

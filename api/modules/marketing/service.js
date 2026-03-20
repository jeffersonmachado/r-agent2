'use strict';

function parsePaging(urlString, defaults = { limit: 200, offset: 0 }) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  const limit = urlObj.searchParams.get('limit');
  const offset = urlObj.searchParams.get('offset');

  return {
    limit: limit != null ? Number(limit) : defaults.limit,
    offset: offset != null ? Number(offset) : defaults.offset,
  };
}

function createMarketingService({ marketingService, marketingLinkService }) {
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

    async sendEmailCampaignNow({ tenantId, campaignId, url }) {
      const urlObj = new URL(url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');

      return marketingService.sendEmailCampaignNow({
        tenantId,
        campaignId,
        limit: limit != null ? Number(limit) : 2000,
      });
    },
  };
}

module.exports = {
  createMarketingService,
};

'use strict';

function createMarketingController({ service, deps }) {
  function bestEffortLogAction(payload) {
    try {
      if (typeof deps.logAction === 'function') {
        deps.logAction(payload);
      }
    } catch (_) {}
  }

  function ensurePermission(req, res, resource, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }

    return true;
  }

  function requireJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }

    return true;
  }

  return {
    async listForms(req, res) {
      if (!ensurePermission(req, res, 'config', 'read')) return;
      try {
        const items = await service.listForms({ tenantId: req.tenantId });
        deps.sendJson(res, 200, { ok: true, items });
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar forms:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar forms' });
      }
    },

    async upsertForm(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.upsertForm({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, { ok: false, error: out.error });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao upsert form:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar form' });
      }
    },

    async listLinks(req, res) {
      if (!ensurePermission(req, res, 'config', 'read')) return;
      try {
        const out = await service.listLinks({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'links_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar links:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar links' });
      }
    },

    async createLink(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.createLink({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, { ok: false, error: out.error });
          return;
        }
        deps.sendJson(res, 201, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao criar link:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar link' });
      }
    },

    async listLeads(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.listLeads({ tenantId: req.tenantId, url: req.url });
        deps.sendJson(res, 200, { ok: true, ...out });
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar leads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar leads' });
      }
    },

    async upsertLead(req, res) {
      if (!ensurePermission(req, res, 'crm', 'create')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.upsertLead({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, out.created ? 201 : 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao upsert lead:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar lead' });
      }
    },

    async updateLead(req, res) {
      if (!ensurePermission(req, res, 'crm', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.updateLead({
          tenantId: req.tenantId,
          leadId: String(req.params.leadId || ''),
          body: await deps.parseJsonBody(req),
        });
        if (!out.ok) {
          deps.sendJson(res, out.error === 'lead_not_found' ? 404 : 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao atualizar lead:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar lead' });
      }
    },

    async leadStats(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.getLeadStats({ tenantId: req.tenantId });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao obter stats:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats' });
      }
    },

    async listScoringRules(req, res) {
      if (!ensurePermission(req, res, 'config', 'read')) return;
      try {
        const items = await service.listScoringRules({ tenantId: req.tenantId });
        deps.sendJson(res, 200, { ok: true, items });
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar scoring rules:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar scoring rules' });
      }
    },

    async upsertScoringRule(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.upsertScoringRule({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao upsert scoring rule:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar scoring rule' });
      }
    },

    async createEmailCampaign(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.createEmailCampaign({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 201, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao criar campanha:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar campanha' });
      }
    },

    async listEmailCampaigns(req, res) {
      if (!ensurePermission(req, res, 'config', 'read')) return;
      try {
        const out = await service.listEmailCampaigns({ tenantId: req.tenantId, url: req.url });
        deps.sendJson(res, 200, { ok: true, ...out });
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar campanhas:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar campanhas' });
      }
    },

    async sendEmailCampaignNow(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      try {
        const out = await service.sendEmailCampaignNow({
          tenantId: req.tenantId,
          campaignId: String(req.params.campaignId),
          url: req.url,
        });
        if (!out.ok) {
          const msg = out.error === 'campaign_not_found' ? 'Campanha não encontrada' : 'Falha ao enviar';
          deps.sendJson(res, 400, { ok: false, error: out.error, message: msg });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao enviar campanha:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao enviar campanha' });
      }
    },

    async getGoogleAdsSettings(req, res) {
      if (!ensurePermission(req, res, 'config', 'read')) return;
      try {
        const out = await service.getGoogleAdsSettings({ tenantId: req.tenantId });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'settings_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao obter Google Ads settings:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter Google Ads settings' });
      }
    },

    async upsertGoogleAdsSettings(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.upsertGoogleAdsSettings({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao salvar Google Ads settings:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar Google Ads settings' });
      }
    },

    async listGoogleAdsConversions(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.listGoogleAdsConversions({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'conversions_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar Google Ads conversions:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversões Google Ads' });
      }
    },

    async createGoogleAdsConversion(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.createGoogleAdsConversion({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 201, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao criar Google Ads conversion:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar conversão Google Ads' });
      }
    },

    async uploadGoogleAdsConversions(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      try {
        const out = await service.uploadGoogleAdsConversions({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao enviar Google Ads conversions:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao enviar conversões Google Ads' });
      }
    },

    async syncGoogleAdsKeywordPerformance(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.syncGoogleAdsKeywordPerformance({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao sincronizar keyword performance Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao sincronizar keywords Google Ads' });
      }
    },

    async listGoogleAdsKeywordPerformance(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.listGoogleAdsKeywordPerformance({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'keyword_performance_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar keyword performance Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar keyword performance Google Ads' });
      }
    },

    async listGoogleAdsSearchTermPerformance(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.listGoogleAdsSearchTermPerformance({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'search_term_performance_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar search terms Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar search terms Google Ads' });
      }
    },

    async analyzeGoogleAdsKeywords(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      if (!requireJson(req, res)) return;
      try {
        const out = await service.analyzeGoogleAdsKeywords({ tenantId: req.tenantId, body: await deps.parseJsonBody(req) });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao analisar keywords Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao analisar keywords Google Ads' });
      }
    },

    async applyGoogleAdsKeywordAction(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const out = await service.applyGoogleAdsKeywordAction({ tenantId: req.tenantId, body });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        bestEffortLogAction({
          agentId: req?.agent?.id || null,
          username: req?.agent?.username || null,
          tenantId: req.tenantId,
          action: 'marketing_google_ads_keyword_action_apply',
          resource: 'marketing_google_ads_keyword_action',
          resourceId: body?.keywordId || body?.term || body?.keywordText || null,
          details: {
            actionType: body?.action || null,
            campaignId: body?.campaignId || null,
            adGroupId: body?.adGroupId || null,
            dryRun: body?.dryRun === true,
          },
          ipAddress: req?.ip || 'unknown',
          userAgent: req?.headers?.['user-agent'] || 'unknown',
        });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao aplicar ação de keyword Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao aplicar ação Google Ads' });
      }
    },

    async syncGoogleAdsRecommendations(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const out = await service.syncGoogleAdsRecommendations({ tenantId: req.tenantId, body });
        if (!out.ok) {
          deps.sendJson(res, 400, out);
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao sincronizar recomendações Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao sincronizar recomendações Google Ads' });
      }
    },

    async listGoogleAdsRecommendations(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.listGoogleAdsRecommendations({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'recommendations_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar recomendações Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar recomendações Google Ads' });
      }
    },

    async updateGoogleAdsRecommendation(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const out = await service.updateGoogleAdsRecommendation({
          tenantId: req.tenantId,
          recommendationId: String(req.params.recommendationId || ''),
          body,
        });
        if (!out.ok) {
          deps.sendJson(res, out.error === 'recommendation_not_found' ? 404 : 400, out);
          return;
        }
        bestEffortLogAction({
          agentId: req?.agent?.id || null,
          username: req?.agent?.username || null,
          tenantId: req.tenantId,
          action: 'marketing_google_ads_recommendation_status_update',
          resource: 'marketing_google_ads_recommendation',
          resourceId: String(req.params.recommendationId || ''),
          details: { status: body?.status || null, note: body?.note || null },
          ipAddress: req?.ip || 'unknown',
          userAgent: req?.headers?.['user-agent'] || 'unknown',
        });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao atualizar recomendação Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar recomendação Google Ads' });
      }
    },

    async applyGoogleAdsRecommendation(req, res) {
      if (!ensurePermission(req, res, 'config', 'update')) return;
      if (!requireJson(req, res)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const out = await service.applyGoogleAdsRecommendation({
          tenantId: req.tenantId,
          recommendationId: String(req.params.recommendationId || ''),
          body,
        });
        if (!out.ok) {
          deps.sendJson(res, out.error === 'recommendation_not_found' ? 404 : 400, out);
          return;
        }
        bestEffortLogAction({
          agentId: req?.agent?.id || null,
          username: req?.agent?.username || null,
          tenantId: req.tenantId,
          action: 'marketing_google_ads_recommendation_apply',
          resource: 'marketing_google_ads_recommendation',
          resourceId: String(req.params.recommendationId || ''),
          details: { dryRun: body?.dryRun === true },
          ipAddress: req?.ip || 'unknown',
          userAgent: req?.headers?.['user-agent'] || 'unknown',
        });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao aplicar recomendação Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao aplicar recomendação Google Ads' });
      }
    },

    async getGoogleAdsRoiBreakdown(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.getGoogleAdsRoiBreakdown({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'roi_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar ROI Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar ROI Google Ads' });
      }
    },

    async getGoogleAdsAttributionExceptions(req, res) {
      if (!ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const out = await service.getGoogleAdsAttributionExceptions({ tenantId: req.tenantId, url: req.url });
        if (!out.ok) {
          deps.sendJson(res, 503, { error: out.error || 'attribution_exceptions_unavailable' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[Marketing] Erro ao listar exceções de atribuição Google Ads:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar exceções de atribuição' });
      }
    },
  };
}

module.exports = {
  createMarketingController,
};

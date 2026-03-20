'use strict';

function createMarketingController({ service, deps }) {
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
  };
}

module.exports = {
  createMarketingController,
};

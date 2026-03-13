/**
 * Marketing Route Handler
 * Handles: Forms, links, leads, scoring rules, and email campaigns
 */

async function handleMarketingRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  // -----------------------------------------------------------------------
  // Marketing v1 (Admin / autenticado)
  // -----------------------------------------------------------------------
  // GET /api/marketing/forms
  if (method === 'GET' && pathname === '/api/marketing/forms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const marketing = require('../services/marketing/marketingService');
      const items = await marketing.listForms({ tenantId: req.tenantId });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[Marketing] Erro ao listar forms:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar forms' });
    }
    return true;
  }

  // POST /api/marketing/forms
  if (method === 'POST' && pathname === '/api/marketing/forms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const slug = body && body.slug ? String(body.slug).trim() : '';
      const name = body && body.name ? String(body.name).trim() : '';
      const fields = body && body.fields ? body.fields : {};
      const landingHtml = body && body.landingHtml != null ? body.landingHtml : null;
      const settings = body && body.settings ? body.settings : {};
      const status = body && body.status ? String(body.status).trim() : 'active';

      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.upsertForm({ tenantId: req.tenantId, slug, name, fields, landingHtml, settings, status });
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao upsert form:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar form' });
    }
    return true;
  }

  // GET /api/marketing/links
  if (method === 'GET' && pathname === '/api/marketing/links') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');
      const service = require('../services/marketing/marketingLinkService');
      const out = await service.listLinks({
        tenantId: req.tenantId,
        limit: limit != null ? Number(limit) : 200,
        offset: offset != null ? Number(offset) : 0,
      });
      if (!out.ok) {
        sendJson(res, 503, { error: out.error || 'links_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao listar links:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar links' });
    }
    return true;
  }

  // POST /api/marketing/links
  if (method === 'POST' && pathname === '/api/marketing/links') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const service = require('../services/marketing/marketingLinkService');
      const out = await service.createLink({
        tenantId: req.tenantId,
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
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error });
        return true;
      }
      sendJson(res, 201, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao criar link:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar link' });
    }
    return true;
  }

  // GET /api/marketing/leads?stage=&minScore=&limit=&offset=
  if (method === 'GET' && pathname === '/api/marketing/leads') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const stage = urlObj.searchParams.get('stage');
      const minScore = urlObj.searchParams.get('minScore');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.listLeads({
        tenantId: req.tenantId,
        stage: stage ? String(stage) : null,
        minScore: minScore != null ? Number(minScore) : null,
        limit: limit != null ? Number(limit) : 200,
        offset: offset != null ? Number(offset) : 0,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[Marketing] Erro ao listar leads:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar leads' });
    }
    return true;
  }

  // GET /api/marketing/leads/stats
  if (method === 'GET' && pathname === '/api/marketing/leads/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.getLeadStats({ tenantId: req.tenantId });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao obter stats:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats' });
    }
    return true;
  }

  // GET /api/marketing/scoring-rules
  if (method === 'GET' && pathname === '/api/marketing/scoring-rules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const marketing = require('../services/marketing/marketingService');
      const items = await marketing.listScoringRules({ tenantId: req.tenantId });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[Marketing] Erro ao listar scoring rules:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar scoring rules' });
    }
    return true;
  }

  // POST /api/marketing/scoring-rules
  if (method === 'POST' && pathname === '/api/marketing/scoring-rules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.upsertScoringRule({
        tenantId: req.tenantId,
        id: body && body.id ? String(body.id).trim() : null,
        name: body && body.name ? String(body.name).trim() : null,
        enabled: body ? body.enabled !== false : true,
        eventType: body && body.eventType ? String(body.eventType).trim() : null,
        delta: body && body.delta != null ? Number(body.delta) : 0,
        conditions: body && body.conditions ? body.conditions : null,
      });
      if (!out.ok) {
        sendJson(res, 400, out);
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao upsert scoring rule:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar scoring rule' });
    }
    return true;
  }

  // POST /api/marketing/email-campaigns
  if (method === 'POST' && pathname === '/api/marketing/email-campaigns') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.createEmailCampaign({
        tenantId: req.tenantId,
        name: body && body.name ? String(body.name).trim() : null,
        subject: body && body.subject ? String(body.subject).trim() : null,
        bodyText: body && body.bodyText != null ? body.bodyText : null,
        bodyHtml: body && body.bodyHtml != null ? body.bodyHtml : null,
        minScore: body && body.minScore != null ? Number(body.minScore) : null,
      });
      if (!out.ok) {
        sendJson(res, 400, out);
        return true;
      }
      sendJson(res, 201, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao criar campanha:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar campanha' });
    }
    return true;
  }

  // POST /api/marketing/email-campaigns/:id/send?limit=
  if (method === 'POST' && pathname.startsWith('/api/marketing/email-campaigns/') && pathname.endsWith('/send')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const id = decodeURIComponent(pathname.slice('/api/marketing/email-campaigns/'.length).replace(/\/send$/, '')).trim();
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');
      const marketing = require('../services/marketing/marketingService');
      const out = await marketing.sendEmailCampaignNow({ tenantId: req.tenantId, campaignId: id, limit: limit != null ? Number(limit) : 2000 });
      if (!out.ok) {
        const msg = out.error === 'campaign_not_found' ? 'Campanha não encontrada' : 'Falha ao enviar';
        sendJson(res, 400, { ok: false, error: out.error, message: msg });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[Marketing] Erro ao enviar campanha:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao enviar campanha' });
    }
    return true;
  }

  // Not a marketing route
  return false;
}

module.exports = { handleMarketingRoutes };

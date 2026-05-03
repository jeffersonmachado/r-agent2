// Contact Center (CC) - v1
// Rotas: /api/cc/*

async function handlePbxContactCenterRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    buildApiError,
  } = deps;

  if (!pathname.startsWith('/api/cc')) {
    return false;
  }

  // GET /api/cc/pause-reasons
  if (method === 'GET' && pathname === '/api/cc/pause-reasons') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const ccReasons = require('../../../services/cc/ccReasonsService');
      const items = await ccReasons.listPauseReasons({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/pause-reasons', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar motivos de pausa' });
    }
    return true;
  }

  // POST /api/cc/pause-reasons (upsert)
  if (method === 'POST' && pathname === '/api/cc/pause-reasons') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const ccReasons = require('../../../services/cc/ccReasonsService');
      const actorUserId = req.user?.id || null;
      const item = await ccReasons.upsertPauseReason({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_pause_reason_upsert_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar motivo de pausa',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/contact-reasons
  if (method === 'GET' && pathname === '/api/cc/contact-reasons') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const ccReasons = require('../../../services/cc/ccReasonsService');
      const items = await ccReasons.listContactReasons({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/contact-reasons', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar motivos de contato' });
    }
    return true;
  }

  // POST /api/cc/contact-reasons (upsert)
  if (method === 'POST' && pathname === '/api/cc/contact-reasons') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const ccReasons = require('../../../services/cc/ccReasonsService');
      const actorUserId = req.user?.id || null;
      const item = await ccReasons.upsertContactReason({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_contact_reason_upsert_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar motivo de contato',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/campaigns
  if (method === 'GET' && pathname === '/api/cc/campaigns') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const ccCampaigns = require('../../../services/cc/ccCampaignsService');
      const items = await ccCampaigns.listCampaigns({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/campaigns', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar campanhas' });
    }
    return true;
  }

  // POST /api/cc/campaigns (upsert)
  if (method === 'POST' && pathname === '/api/cc/campaigns') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const ccCampaigns = require('../../../services/cc/ccCampaignsService');
      const actorUserId = req.user?.id || null;
      const item = await ccCampaigns.upsertCampaign({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_campaign_upsert_error';
      const httpStatus = code === 'campaign_name_required' ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar campanha',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/campaigns/list?campaignId=...
  if (method === 'GET' && pathname === '/api/cc/campaigns/list') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const campaignId = urlObj.searchParams.get('campaignId');
      if (!campaignId) {
        sendJson(res, 400, { error: 'bad_request', message: 'campaignId obrigatório' });
        return true;
      }
      const ccCampaigns = require('../../../services/cc/ccCampaignsService');
      const items = await ccCampaigns.listCampaignList({ tenantKey, campaignId: String(campaignId) });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/campaigns/list', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar lista de campanha' });
    }
    return true;
  }

  // POST /api/cc/campaigns/list (add items)
  if (method === 'POST' && pathname === '/api/cc/campaigns/list') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const campaignId = body?.campaignId ? String(body.campaignId) : null;
      if (!campaignId) {
        sendJson(res, 400, { error: 'bad_request', message: 'campaignId obrigatório' });
        return true;
      }
      const ccCampaigns = require('../../../services/cc/ccCampaignsService');
      const added = await ccCampaigns.addCampaignListItems({ tenantKey, campaignId, items: body?.items || [] });
      sendJson(res, 200, { ok: true, addedCount: added.length, added });
    } catch (err) {
      logger.error('[CC] Erro em POST /api/cc/campaigns/list', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao adicionar itens na campanha' });
    }
    return true;
  }

  // GET /api/cc/scheduled-callbacks
  if (method === 'GET' && pathname === '/api/cc/scheduled-callbacks') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const ccSched = require('../../../services/cc/ccScheduledCallbacksService');
      const items = await ccSched.listScheduledCallbacks({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/scheduled-callbacks', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar agendados' });
    }
    return true;
  }

  // POST /api/cc/scheduled-callbacks (upsert)
  if (method === 'POST' && pathname === '/api/cc/scheduled-callbacks') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const ccSched = require('../../../services/cc/ccScheduledCallbacksService');
      const actorUserId = req.user?.id || null;
      const item = await ccSched.upsertScheduledCallback({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_scheduled_upsert_error';
      const httpStatus = ['scheduled_at_invalid', 'scheduled_phone_required'].includes(code) ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar agendado',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/click2call
  if (method === 'GET' && pathname === '/api/cc/click2call') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit') || '100';
      const ccC2C = require('../../../services/cc/ccClick2CallService');
      const items = await ccC2C.listClick2CallRequests({ tenantKey, limit });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/click2call', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar click2call' });
    }
    return true;
  }

  // POST /api/cc/click2call
  if (method === 'POST' && pathname === '/api/cc/click2call') {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const ccC2C = require('../../../services/cc/ccClick2CallService');
      const actorUserId = req.user?.id || null;
      const item = await ccC2C.createClick2CallRequest({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_click2call_create_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao criar click2call',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // ─── CC Queue Reports ──────────────────────────────────────────────────────
  // Prefixo: GET /api/cc/reports/:reportType
  // Parâmetros de query: from, to, queueName, limit
  if (method === 'GET' && pathname.startsWith('/api/cc/reports/')) {
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
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;

    const reportType = pathname.replace('/api/cc/reports/', '').split('/')[0];
    const filters = {
      from: req.query?.from || null,
      to: req.query?.to || null,
      queueName: req.query?.queueName || null,
      limit: req.query?.limit || 500,
    };

    const REPORT_MAP = {
      atendidas: 'getAnsweredReport',
      abandonadas: 'getAbandonedReport',
      agentes: 'getAgentsReport',
      'por-hora': 'getHourlyReport',
      'resumo-campanha': 'getCampaignSummaryReport',
      pesquisa: 'getSurveyReport',
    };

    const fnName = REPORT_MAP[reportType];
    if (!fnName) {
      sendJson(res, 404, { error: 'not_found', message: `Relatório '${reportType}' não encontrado` });
      return true;
    }

    try {
      const ccReports = require('../../../services/cc/ccQueueReportsService');
      const data = await ccReports[fnName]({ tenantKey, filters });
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      logger.error(`[CC] Erro em GET /api/cc/reports/${reportType}`, err);
      sendJson(res, 500, buildApiError({
        code: 'cc_report_error',
        message: err.message || 'Erro ao gerar relatório',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxContactCenterRoutes };

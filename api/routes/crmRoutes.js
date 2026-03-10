'use strict';

const {
  getUrl,
  decodeRouteParam,
  buildOperationalPipelineService,
  sendQuickActionScopeError,
  resolveQuickActionExecutionStatus,
  extractQuickActionSupportContext,
  resolveQuickActionScopeForRequest,
} = require('./support/shared');

function isCrmPlaybooksPath(pathname) {
  return /^\/api\/crm\/contacts\/[^/]+\/playbooks$/.test(pathname)
    || /^\/api\/operational\/crm\/contact\/[^/]+\/playbooks$/.test(pathname);
}

function extractContactIdFromPlaybooksPath(pathname) {
  const crmMatch = pathname.match(/^\/api\/crm\/contacts\/([^/]+)\/playbooks$/);
  if (crmMatch) return decodeRouteParam(crmMatch, 1);
  const aliasMatch = pathname.match(/^\/api\/operational\/crm\/contact\/([^/]+)\/playbooks$/);
  return decodeRouteParam(aliasMatch, 1);
}

async function handleCrmRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-profile$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: ticketPerm.error || analyticsPerm.error || 'Sem permissão para perfil operacional CRM' });
      return true;
    }
    try {
      const urlObj = getUrl(req);
      const timelineLimit = urlObj.searchParams.get('timelineLimit');
      const contactId = decodeURIComponent(pathname.slice('/api/crm/contacts/'.length, -'/operational-profile'.length)).trim();
      const { CRMContactProfileService } = require('../core/crm');
      const out = await CRMContactProfileService.getContactOperationalProfile({
        tenantId: req.tenantId,
        contactId,
        timelineLimit: timelineLimit != null ? Number(timelineLimit) : 30,
      });
      if (!out.ok) {
        const status = out.error === 'contact_not_found' ? 404 : 400;
        sendJson(res, status, out);
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar perfil operacional do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar perfil operacional do contato' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-summary$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: ticketPerm.error || analyticsPerm.error || 'Sem permissão para resumo operacional CRM' });
      return true;
    }
    try {
      const urlObj = getUrl(req);
      const recentWindowHours = Number(urlObj.searchParams.get('recentWindowHours') || 72);
      const contactId = decodeURIComponent(pathname.slice('/api/crm/contacts/'.length, -'/operational-summary'.length)).trim();
      const { CRMEventService } = require('../core/crm');
      const out = await CRMEventService.getContactOperationalSummary({
        tenantId: req.tenantId,
        contactId,
        recentWindowHours,
      });
      if (!out.ok) {
        const status = out.error === 'contact_not_found' ? 404 : 400;
        sendJson(res, status, out);
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar resumo operacional do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar resumo operacional do contato' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-signals$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: ticketPerm.error || analyticsPerm.error || 'Sem permissão para sinais operacionais CRM' });
      return true;
    }
    try {
      const urlObj = getUrl(req);
      const contactId = decodeURIComponent(pathname.slice('/api/crm/contacts/'.length, -'/operational-signals'.length)).trim();
      const activeOnly = urlObj.searchParams.get('activeOnly') === 'true';
      const limit = Number(urlObj.searchParams.get('limit') || 100);
      const service = buildOperationalPipelineService();
      await service.generateContactSignals({ tenantId: req.tenantId, contactId });
      const out = await service.listContactSignals({ tenantId: req.tenantId, contactId, activeOnly, limit });
      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar sinais operacionais do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar sinais operacionais do contato' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-recommendations$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: ticketPerm.error || analyticsPerm.error || 'Sem permissão para recomendações operacionais CRM' });
      return true;
    }
    try {
      const urlObj = getUrl(req);
      const contactId = decodeURIComponent(pathname.slice('/api/crm/contacts/'.length, -'/operational-recommendations'.length)).trim();
      const limit = Number(urlObj.searchParams.get('limit') || 100);
      const service = buildOperationalPipelineService();
      await service.generateContactRecommendations({ tenantId: req.tenantId, contactId, includeSignalGeneration: true });
      const out = await service.listContactRecommendations({ tenantId: req.tenantId, contactId, limit });
      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar recomendações operacionais do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar recomendações operacionais do contato' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-outcomes$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    const crmPerm = requirePermission(req, 'crm', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed && !crmPerm.allowed) {
      sendJson(res, 403, {
        error: 'forbidden',
        message: ticketPerm.error || analyticsPerm.error || crmPerm.error || 'Sem permissão para outcomes operacionais',
      });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit');
      const status = urlObj.searchParams.get('status');
      const sourceType = urlObj.searchParams.get('sourceType') || urlObj.searchParams.get('source_type');
      const sourceId = urlObj.searchParams.get('sourceId') || urlObj.searchParams.get('source_id');
      const contactId = decodeURIComponent(pathname.slice('/api/crm/contacts/'.length, -'/operational-outcomes'.length)).trim();
      const tenantId = req.tenantId || req.agent?.tenantId || null;
      const { operationalOutcomeEngine } = require('../core/operational-outcomes');
      const out = await operationalOutcomeEngine.listContactOutcomes({
        tenantId,
        contactId,
        limit: limit != null ? Number(limit) : 120,
        status: status ? String(status).trim() : null,
        sourceType: sourceType ? String(sourceType).trim() : null,
        sourceId: sourceId ? String(sourceId).trim() : null,
      });
      if (!out.ok) {
        sendJson(res, 400, out);
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar outcomes operacionais do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar outcomes operacionais do contato' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-signals\/[^/]+\/quick-actions$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const match = pathname.match(/^\/api\/crm\/contacts\/([^/]+)\/operational-signals\/([^/]+)\/quick-actions$/);
      const contactId = decodeRouteParam(match, 1);
      const signalId = decodeRouteParam(match, 2);
      const supportContext = extractQuickActionSupportContext({ req });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'contact',
        operation: 'list',
        contactId,
        sourceType: 'signal',
        sourceId: signalId,
        supportContext,
        deps: context.deps,
      });

      if (!scopeOut.ok) {
        sendQuickActionScopeError(sendJson, res, scopeOut);
        return true;
      }

      sendJson(res, 200, { ok: true, items: scopeOut.actions || [] });
    } catch (err) {
      logger.error('[CRM] Erro ao listar quick actions de sinal por contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar quick actions do sinal operacional' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-signals\/[^/]+\/quick-actions\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const match = pathname.match(/^\/api\/crm\/contacts\/([^/]+)\/operational-signals\/([^/]+)\/quick-actions\/([^/]+)$/);
      const contactId = decodeRouteParam(match, 1);
      const signalId = decodeRouteParam(match, 2);
      const actionId = decodeRouteParam(match, 3);
      const supportContext = extractQuickActionSupportContext({ req, body });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'contact',
        operation: 'execute',
        contactId,
        sourceType: 'signal',
        sourceId: signalId,
        actionId,
        supportContext,
        deps: context.deps,
      });

      if (!scopeOut.ok) {
        sendQuickActionScopeError(sendJson, res, scopeOut);
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = await pipeline.executeAction({
        tenantId: scopeOut.tenantId,
        sourceType: 'signal',
        sourceId: scopeOut.source?.id || signalId,
        actionId,
        contactId: scopeOut.contactId || contactId || body?.contactId || null,
        actorType: body?.actorType || 'operator',
        actorId: req.agent?.id || req.agent?.username || null,
        input: body?.input || {},
      });

      sendJson(res, out.ok ? 200 : resolveQuickActionExecutionStatus(out), out);
    } catch (err) {
      logger.error('[CRM] Erro ao executar quick action de sinal por contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar quick action do sinal operacional' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-recommendations\/[^/]+\/quick-actions$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const match = pathname.match(/^\/api\/crm\/contacts\/([^/]+)\/operational-recommendations\/([^/]+)\/quick-actions$/);
      const contactId = decodeRouteParam(match, 1);
      const recommendationId = decodeRouteParam(match, 2);
      const supportContext = extractQuickActionSupportContext({ req });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'contact',
        operation: 'list',
        contactId,
        sourceType: 'recommendation',
        sourceId: recommendationId,
        supportContext,
        deps: context.deps,
      });

      if (!scopeOut.ok) {
        sendQuickActionScopeError(sendJson, res, scopeOut);
        return true;
      }

      sendJson(res, 200, { ok: true, items: scopeOut.actions || [] });
    } catch (err) {
      logger.error('[CRM] Erro ao listar quick actions de recomendação por contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar quick actions da recomendação operacional' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/crm\/contacts\/[^/]+\/operational-recommendations\/[^/]+\/quick-actions\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const match = pathname.match(/^\/api\/crm\/contacts\/([^/]+)\/operational-recommendations\/([^/]+)\/quick-actions\/([^/]+)$/);
      const contactId = decodeRouteParam(match, 1);
      const recommendationId = decodeRouteParam(match, 2);
      const actionId = decodeRouteParam(match, 3);
      const supportContext = extractQuickActionSupportContext({ req, body });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'contact',
        operation: 'execute',
        contactId,
        sourceType: 'recommendation',
        sourceId: recommendationId,
        actionId,
        supportContext,
        deps: context.deps,
      });

      if (!scopeOut.ok) {
        sendQuickActionScopeError(sendJson, res, scopeOut);
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = await pipeline.executeAction({
        tenantId: scopeOut.tenantId,
        sourceType: 'recommendation',
        sourceId: scopeOut.source?.id || recommendationId,
        actionId,
        contactId: scopeOut.contactId || contactId || body?.contactId || null,
        actorType: body?.actorType || 'operator',
        actorId: req.agent?.id || req.agent?.username || null,
        input: body?.input || {},
      });

      sendJson(res, out.ok ? 200 : resolveQuickActionExecutionStatus(out), out);
    } catch (err) {
      logger.error('[CRM] Erro ao executar quick action de recomendação por contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar quick action da recomendação operacional' });
    }
    return true;
  }

  if (method === 'GET' && isCrmPlaybooksPath(pathname)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const ticketPerm = requirePermission(req, 'tickets', 'read');
    const analyticsPerm = requirePermission(req, 'analytics', 'read');
    if (!ticketPerm.allowed && !analyticsPerm.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: ticketPerm.error || analyticsPerm.error || 'Sem permissão para playbooks operacionais CRM' });
      return true;
    }

    try {
      const urlObj = getUrl(req);
      const contactId = extractContactIdFromPlaybooksPath(pathname);
      const limit = Number(urlObj.searchParams.get('limit') || 12);
      const { operationalPlaybookEngine } = require('../core/operational-playbooks');
      const out = await operationalPlaybookEngine.listSuggestedPlaybooksForContact({
        tenantId: req.tenantId,
        contactId,
        limit,
      });
      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('[CRM] Erro ao carregar playbooks operacionais do contato:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao carregar playbooks operacionais do contato' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleCrmRoutes,
};

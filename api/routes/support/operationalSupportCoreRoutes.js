'use strict';

const {
  getUrl,
  decodeRouteParam,
  buildOperationalPipelineService,
  buildOperationalContextQueryService,
  readSupportOutcomeFilters,
  extractQuickActionSupportContext,
  resolveQuickActionScopeForRequest,
  resolveOperationalTenantFromRequest,
} = require('./shared');

async function handleOperationalSupportCoreRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      isSuperAdmin,
      sendJson,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname === '/api/operational/signals') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permTicket = requirePermission(req, 'tickets', 'read');
    const permAnalytics = requirePermission(req, 'analytics', 'read');
    if (!permTicket.allowed && !permAnalytics.allowed && !isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: permTicket.error || permAnalytics.error || 'Sem permissão para sinais operacionais' });
      return true;
    }

    try {
      const urlObj = getUrl(req);
      const contactId = String(urlObj.searchParams.get('contactId') || '').trim() || null;
      const activeOnly = urlObj.searchParams.get('activeOnly') === 'true';
      const limit = Number(urlObj.searchParams.get('limit') || 120);
      const routeTenantId = String(urlObj.searchParams.get('tenantId') || '').trim() || null;
      const tenantId = resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId);

      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = contactId
        ? await pipeline.listContactSignals({ tenantId, contactId, activeOnly, limit })
        : await pipeline.listOccSignals({ tenantId, activeOnly, limit });

      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao listar sinais operacionais (/api/operational/signals):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/operational/recommendations') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permTicket = requirePermission(req, 'tickets', 'read');
    const permAnalytics = requirePermission(req, 'analytics', 'read');
    if (!permTicket.allowed && !permAnalytics.allowed && !isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: permTicket.error || permAnalytics.error || 'Sem permissão para recomendações operacionais' });
      return true;
    }

    try {
      const urlObj = getUrl(req);
      const contactId = String(urlObj.searchParams.get('contactId') || '').trim() || null;
      const limit = Number(urlObj.searchParams.get('limit') || 120);
      const routeTenantId = String(urlObj.searchParams.get('tenantId') || '').trim() || null;
      const tenantId = resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId);

      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = contactId
        ? await pipeline.listContactRecommendations({ tenantId, contactId, limit })
        : await pipeline.listOccRecommendations({ tenantId, limit });

      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao listar recomendações operacionais (/api/operational/recommendations):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/operational\/context\/[^/]+\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permTicket = requirePermission(req, 'tickets', 'read');
    const permAnalytics = requirePermission(req, 'analytics', 'read');
    const permCrm = requirePermission(req, 'crm', 'read');
    if (!permTicket.allowed && !permAnalytics.allowed && !permCrm.allowed && !isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Sem permissão para contexto operacional' });
      return true;
    }

    try {
      const match = pathname.match(/^\/api\/operational\/context\/([^/]+)\/([^/]+)$/);
      const entityType = String(decodeRouteParam(match, 1)).trim().toLowerCase();
      const entityId = String(decodeRouteParam(match, 2)).trim();
      if (!entityType || !entityId) {
        sendJson(res, 400, { ok: false, error: 'invalid_entity' });
        return true;
      }

      const urlObj = getUrl(req);
      const routeTenantId = String(urlObj.searchParams.get('tenantId') || '').trim() || null;
      const limit = Math.max(1, Math.min(Number(urlObj.searchParams.get('limit') || 80), 200));
      const sourceType = String(urlObj.searchParams.get('sourceType') || '').trim().toLowerCase() || null;
      const sourceId = String(urlObj.searchParams.get('sourceId') || '').trim() || null;
      const tenantId = resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId);
      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const isContactEntity = ['contact', 'crm_contact'].includes(entityType);
      const contactId = isContactEntity
        ? entityId
        : (String(urlObj.searchParams.get('contactId') || '').trim() || null);

      let actions = [];
      if (sourceType && sourceId && ['signal', 'recommendation'].includes(sourceType)) {
        const supportContext = extractQuickActionSupportContext({ req });
        const scopeOut = await resolveQuickActionScopeForRequest({
          req,
          mode: contactId ? 'contact' : 'admin',
          operation: 'list',
          routeTenantId: contactId ? null : tenantId,
          contactId,
          sourceType,
          sourceId,
          supportContext,
          deps: context.deps,
        });
        if (scopeOut.ok) actions = scopeOut.actions || [];
      }

      const contextOut = await buildOperationalContextQueryService().getEntityContext({
        tenantId,
        entityType,
        entityId,
        contactId,
        limit,
        sourceType,
        sourceId,
        actions,
      });

      sendJson(res, 200, contextOut);
    } catch (err) {
      logger.error('Erro ao montar contexto operacional (/api/operational/context/:entityType/:entityId):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/operational/outcomes') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permTicket = requirePermission(req, 'tickets', 'read');
    const permAnalytics = requirePermission(req, 'analytics', 'read');
    if (!permTicket.allowed && !permAnalytics.allowed && !isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Sem permissão para outcomes operacionais' });
      return true;
    }

    try {
      const urlObj = getUrl(req);
      const routeTenantId = String(urlObj.searchParams.get('tenantId') || '').trim() || null;
      const limit = Math.max(1, Math.min(Number(urlObj.searchParams.get('limit') || 120), 500));
      const filters = readSupportOutcomeFilters(urlObj.searchParams);
      const tenantId = resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId);
      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const out = await buildOperationalPipelineService().listOccOutcomes({
        tenantId,
        limit,
        ...filters,
      });

      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao listar outcomes operacionais (/api/operational/outcomes):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleOperationalSupportCoreRoutes,
};

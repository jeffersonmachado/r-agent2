'use strict';

const {
  decodeRouteParam,
  buildOperationalPipelineService,
  sendQuickActionScopeError,
  resolveQuickActionExecutionStatus,
  extractQuickActionSupportContext,
  resolveQuickActionScopeForRequest,
  resolveOperationalTenantFromRequest,
} = require('./shared');

async function handleOperationalQuickActionRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      isSuperAdmin,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
  } = context;

  if (method === 'GET' && pathname === '/api/operational/actions/available') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
      const sourceType = String(urlObj.searchParams.get('sourceType') || '').trim().toLowerCase();
      const sourceId = String(urlObj.searchParams.get('sourceId') || '').trim();
      const actionId = String(urlObj.searchParams.get('actionId') || '').trim() || null;
      const routeTenantId = String(urlObj.searchParams.get('tenantId') || '').trim() || null;
      const contactId = String(urlObj.searchParams.get('contactId') || '').trim() || null;

      if (!['signal', 'recommendation'].includes(sourceType) || !sourceId) {
        sendJson(res, 400, { ok: false, error: 'invalid_source', message: 'sourceType e sourceId são obrigatórios' });
        return true;
      }

      const tenantId = resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId);
      if (!tenantId && !contactId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const supportContext = extractQuickActionSupportContext({ req });
      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: contactId ? 'contact' : 'admin',
        operation: 'list',
        routeTenantId: contactId ? null : tenantId,
        contactId,
        sourceType,
        sourceId,
        actionId,
        supportContext,
        deps: context.deps,
      });

      if (!scopeOut.ok) {
        sendQuickActionScopeError(sendJson, res, scopeOut);
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        tenantId: scopeOut.tenantId || tenantId || null,
        contactId: scopeOut.contactId || contactId || null,
        source: scopeOut.source || null,
        items: scopeOut.actions || [],
      });
    } catch (err) {
      logger.error('Erro ao listar quick actions disponíveis (/api/operational/actions/available):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/operational/actions/execute') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const sourceType = String(body?.sourceType || '').trim().toLowerCase();
      const sourceId = String(body?.sourceId || '').trim();
      const actionId = String(body?.actionId || '').trim();
      const contactId = String(body?.contactId || '').trim() || null;
      const tenantId = isSuperAdmin(req.agent)
        ? (String(body?.tenantId || '').trim() || req.tenantId || req.agent?.tenantId || null)
        : (req.tenantId || null);

      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      if (!['signal', 'recommendation'].includes(sourceType) || !sourceId || !actionId) {
        sendJson(res, 400, { ok: false, error: 'invalid_payload' });
        return true;
      }

      const supportContext = extractQuickActionSupportContext({ req, body });
      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: contactId ? 'contact' : 'admin',
        operation: 'execute',
        routeTenantId: contactId ? null : tenantId,
        contactId,
        sourceType,
        sourceId,
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
        sourceType,
        sourceId: scopeOut.source?.id || sourceId,
        actionId,
        contactId: scopeOut.contactId || contactId,
        actorType: body?.actorType || 'operator',
        actorId: req.agent?.id || req.agent?.username || null,
        input: body?.input || {},
      });

      sendJson(res, out.ok ? 200 : resolveQuickActionExecutionStatus(out), out);
    } catch (err) {
      logger.error('Erro ao executar quick action (/api/operational/actions/execute):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals\/[^/]+\/quick-actions$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals\/([^/]+)\/quick-actions$/);
      const tenantId = decodeRouteParam(match, 1);
      const signalId = decodeRouteParam(match, 2);
      const supportContext = extractQuickActionSupportContext({ req });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'admin',
        operation: 'list',
        routeTenantId: tenantId,
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
      logger.error('Erro ao listar quick actions de sinal (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-signals\/[^/]+\/quick-actions\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-signals\/([^/]+)\/quick-actions\/([^/]+)$/);
      const tenantId = decodeRouteParam(match, 1);
      const signalId = decodeRouteParam(match, 2);
      const actionId = decodeRouteParam(match, 3);
      const supportContext = extractQuickActionSupportContext({ req, body });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'admin',
        operation: 'execute',
        routeTenantId: tenantId,
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
        contactId: scopeOut.contactId || body?.contactId || null,
        actorType: body?.actorType || 'operator',
        actorId: req.agent?.id || req.agent?.username || null,
        input: body?.input || {},
      });
      sendJson(res, out.ok ? 200 : resolveQuickActionExecutionStatus(out), out);
    } catch (err) {
      logger.error('Erro ao executar quick action de sinal (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-recommendations\/[^/]+\/quick-actions$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-recommendations\/([^/]+)\/quick-actions$/);
      const tenantId = decodeRouteParam(match, 1);
      const recommendationId = decodeRouteParam(match, 2);
      const supportContext = extractQuickActionSupportContext({ req });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'admin',
        operation: 'list',
        routeTenantId: tenantId,
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
      logger.error('Erro ao listar quick actions de recomendação (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/tenant\/[^/]+\/operational-recommendations\/[^/]+\/quick-actions\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const match = pathname.match(/^\/api\/admin\/tenant\/([^/]+)\/operational-recommendations\/([^/]+)\/quick-actions\/([^/]+)$/);
      const tenantId = decodeRouteParam(match, 1);
      const recommendationId = decodeRouteParam(match, 2);
      const actionId = decodeRouteParam(match, 3);
      const supportContext = extractQuickActionSupportContext({ req, body });

      const scopeOut = await resolveQuickActionScopeForRequest({
        req,
        mode: 'admin',
        operation: 'execute',
        routeTenantId: tenantId,
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
        contactId: scopeOut.contactId || body?.contactId || null,
        actorType: body?.actorType || 'operator',
        actorId: req.agent?.id || req.agent?.username || null,
        input: body?.input || {},
      });
      sendJson(res, out.ok ? 200 : resolveQuickActionExecutionStatus(out), out);
    } catch (err) {
      logger.error('Erro ao executar quick action de recomendação (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleOperationalQuickActionRoutes,
};

function ensureConfigPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function parseAutomationId(pathname, suffix) {
  return decodeURIComponent(pathname.slice('/automations/'.length, -suffix.length));
}

async function handleAutomationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/automations') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const service = require('../services/automationService');
      const out = await service.listAutomations(tenantId);
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'automations_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, automations: out.automations || [] });
    } catch (err) {
      logger.error('[Automations] Erro ao listar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar automações' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/automations') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const name = body && body.name ? String(body.name).trim() : '';
      if (!name) {
        badRequest(res, 'name é obrigatório');
        return true;
      }

      const service = require('../services/automationService');
      const out = await service.upsertAutomation(tenantId, {
        id: body?.id || null,
        name,
        description: body?.description || '',
        status: body?.status || 'draft',
        definition: body?.definition || {},
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'automations_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, automation: out.automation });
    } catch (err) {
      logger.error('[Automations] Erro ao salvar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar automação' });
    }

    return true;
  }

  if (method === 'POST' && pathname.startsWith('/automations/') && pathname.endsWith('/publish')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const id = parseAutomationId(pathname, '/publish');
      const service = require('../services/automationService');
      const out = await service.publishAutomation(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Automação não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'automations_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, automation: out.automation });
    } catch (err) {
      logger.error('[Automations] Erro ao publicar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao publicar automação' });
    }

    return true;
  }

  if (method === 'POST' && pathname.startsWith('/automations/') && pathname.endsWith('/run')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const id = parseAutomationId(pathname, '/run');
      const service = require('../services/automationService');
      const out = await service.runAutomation(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Automação não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'automations_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, automation: out.automation, run: out.run });
    } catch (err) {
      logger.error('[Automations] Erro ao executar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar automação' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleAutomationRoutes,
};

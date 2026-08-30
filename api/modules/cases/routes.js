'use strict';

const express = require('express');
const caseService = require('../../services/caseService');
const { requireTenantCapability } = require('../../middleware/requireTenantCapability');

/**
 * Rotas de Case Management (/cases).
 *
 * Todas exigem: requireAuth + requireTenantCapability('caseManagement') +
 * requirePermission('tickets', <ação>) — cases são tickets na persistência.
 */

function parseIntQuery(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createCaseRoutes({ buildDeps }) {
  const router = express.Router();

  const caseCapability = requireTenantCapability('caseManagement');
  router.use('/cases', caseCapability);

  function depsFor(req, res) {
    return buildDeps(req, res);
  }

  function ensureAuth(deps, req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function ensureTenant(deps, req, res) {
    const tenantId = deps.requireTenant(req, res);
    return tenantId || null;
  }

  function ensurePermission(deps, req, res, action) {
    const permResult = deps.requirePermission(req, 'tickets', action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  function handleUnexpected(deps, res, logMessage, err) {
    deps.logger.error(logMessage, { error: err && err.message });
    deps.sendJson(res, 500, { error: 'internal_error' });
  }

  router.get('/cases', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = ensureTenant(deps, req, res);
    if (!tenantId) return;
    if (!ensurePermission(deps, req, res, 'read')) return;

    try {
      const result = await caseService.listCases({
        tenantKey: tenantId,
        status: req.query && req.query.status,
        limit: parseIntQuery(req.query && req.query.limit, 100),
        offset: parseIntQuery(req.query && req.query.offset, 0),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      handleUnexpected(deps, res, '[Cases] Erro ao listar cases', err);
    }
  });

  router.get('/cases/:id', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = ensureTenant(deps, req, res);
    if (!tenantId) return;
    if (!ensurePermission(deps, req, res, 'read')) return;

    try {
      const caseId = decodeURIComponent(String(req.params.id || ''));
      const caseData = await caseService.getCase({ tenantKey: tenantId, caseId });
      if (!caseData) {
        deps.sendJson(res, 404, { error: 'case_not_found' });
        return;
      }
      const conversations = await caseService.listCaseConversations({ tenantKey: tenantId, caseId });
      deps.sendJson(res, 200, { case: caseData, conversations });
    } catch (err) {
      handleUnexpected(deps, res, '[Cases] Erro ao obter case', err);
    }
  });

  router.post('/cases/:id/conversations', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = ensureTenant(deps, req, res);
    if (!tenantId) return;
    if (!ensurePermission(deps, req, res, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const conversationId = body && body.conversationId ? String(body.conversationId).trim() : '';
      if (!conversationId) {
        deps.badRequest(res, 'conversationId é obrigatório');
        return;
      }
      const caseId = decodeURIComponent(String(req.params.id || ''));
      const result = await caseService.linkConversationToCase({ tenantKey: tenantId, caseId, conversationId });
      if (!result.ok) {
        deps.sendJson(res, result.status, { error: result.error });
        return;
      }
      deps.sendJson(res, result.status, { ok: true, link: result.link });
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      handleUnexpected(deps, res, '[Cases] Erro ao vincular conversa ao case', err);
    }
  });

  router.delete('/cases/:id/conversations/:conversationId', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = ensureTenant(deps, req, res);
    if (!tenantId) return;
    if (!ensurePermission(deps, req, res, 'update')) return;

    try {
      const caseId = decodeURIComponent(String(req.params.id || ''));
      const conversationId = decodeURIComponent(String(req.params.conversationId || ''));
      const result = await caseService.unlinkConversation({ tenantKey: tenantId, caseId, conversationId });
      if (!result.ok) {
        deps.sendJson(res, result.status, { error: result.error });
        return;
      }
      deps.sendJson(res, 200, { ok: true, removed: result.removed });
    } catch (err) {
      handleUnexpected(deps, res, '[Cases] Erro ao desvincular conversa do case', err);
    }
  });

  return router;
}

module.exports = {
  createCaseRoutes,
};

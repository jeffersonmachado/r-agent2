'use strict';

const express = require('express');

function createQuickRepliesRoutes({ buildDeps }) {
  const router = express.Router();

  function requireTenantAuth(req, res, deps) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return null;
    }
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return null;
    return tenantId;
  }

  router.get('/quick-replies', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
    const filters = {
      tenantId,
      category: urlObj.searchParams.get('category') || undefined,
      tag: urlObj.searchParams.get('tag') || undefined,
      activeOnly: urlObj.searchParams.get('activeOnly') !== 'false',
      search: urlObj.searchParams.get('search') || undefined,
    };

    deps.sendJson(res, 200, { quickReplies: deps.listQuickReplies(filters) });
  });

  router.get('/quick-replies/categories', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const categories = Array.from(
      new Set(deps.listQuickReplies({ tenantId, activeOnly: false }).map((r) => r.category).filter(Boolean)),
    ).sort();
    deps.sendJson(res, 200, { categories });
  });

  router.get('/quick-replies/tags', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const tags = Array.from(
      new Set(deps.listQuickReplies({ tenantId, activeOnly: false }).flatMap((r) => Array.isArray(r.tags) ? r.tags : []).filter(Boolean)),
    ).sort();
    deps.sendJson(res, 200, { tags });
  });

  router.post('/quick-replies/search', async (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const { context, limit = 5 } = body || {};
      if (!context || typeof context !== 'string') {
        deps.badRequest(res, 'Campo "context" é obrigatório e deve ser uma string');
        return;
      }
      deps.sendJson(res, 200, { quickReplies: deps.searchByContext(context, tenantId, limit) });
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      deps.logger.error('Erro ao buscar respostas rápidas:', err);
      deps.sendJson(res, 500, { error: 'internal_error' });
    }
  });

  router.get('/quick-replies/:id', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const reply = deps.getQuickReply(decodeURIComponent(req.params.id));
    if (!reply || reply.tenantId !== tenantId) {
      deps.sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }

    deps.sendJson(res, 200, { quickReply: reply });
  });

  router.post('/quick-replies', async (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const permResult = deps.requirePermission(req, 'quick_replies', 'create');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const result = deps.createQuickReply({ ...body, tenantId, createdBy: req.agent.id });
      if (!result.success) {
        deps.badRequest(res, result.error);
        return;
      }
      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_create',
        resource: 'quick_reply',
        resourceId: result.quickReply.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      deps.sendJson(res, 201, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      deps.logger.error('Erro ao criar resposta rápida:', err);
      deps.sendJson(res, 500, { error: 'internal_error' });
    }
  });

  router.put('/quick-replies/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const permResult = deps.requirePermission(req, 'quick_replies', 'update');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const id = decodeURIComponent(req.params.id);
      const existing = deps.getQuickReply(id);
      if (!existing || existing.tenantId !== tenantId) {
        deps.sendJson(res, 404, { error: 'quick_reply_not_found' });
        return;
      }

      const body = await deps.parseJsonBody(req);
      const updates = body && typeof body === 'object' ? { ...body } : {};
      delete updates.tenantId;
      const result = deps.updateQuickReply(id, updates);
      if (!result.success) {
        deps.badRequest(res, result.error);
        return;
      }
      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'quick_reply_update',
        resource: 'quick_reply',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      deps.sendJson(res, 200, result.quickReply);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      deps.logger.error('Erro ao atualizar resposta rápida:', err);
      deps.sendJson(res, 500, { error: 'internal_error' });
    }
  });

  router.delete('/quick-replies/:id', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const permResult = deps.requirePermission(req, 'quick_replies', 'delete');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const id = decodeURIComponent(req.params.id);
    const existing = deps.getQuickReply(id);
    if (!existing || existing.tenantId !== tenantId) {
      deps.sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }

    const result = deps.deleteQuickReply(id);
    if (!result.success) {
      deps.badRequest(res, result.error);
      return;
    }

    deps.logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'quick_reply_delete',
      resource: 'quick_reply',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    deps.sendJson(res, 200, { success: true });
  });

  router.post('/quick-replies/:id/use', (req, res) => {
    const deps = buildDeps(req, res);
    const tenantId = requireTenantAuth(req, res, deps);
    if (!tenantId) return;

    const id = decodeURIComponent(req.params.id);
    const existing = deps.getQuickReply(id);
    if (!existing || existing.tenantId !== tenantId) {
      deps.sendJson(res, 404, { error: 'quick_reply_not_found' });
      return;
    }

    deps.incrementUsage(id);
    deps.sendJson(res, 200, { success: true });
  });

  return router;
}

module.exports = {
  createQuickRepliesRoutes,
};

async function handleSuperAdminRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    isSuperAdmin,
    sendJson,
    badRequest,
    parseJsonBody,
    logger,
    logAction,
    listAllTenants,
    getTenantMetrics,
    impersonateUser,
    blockTenant,
    unblockTenant,
    adjustTenantPlan,
  } = deps;

  if (!pathname.startsWith('/super-admin/')) {
    return false;
  }

  // GET /super-admin/tenants - Lista todos os tenants (requer Super Admin)
  if (method === 'GET' && pathname === '/super-admin/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return true;
    }

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        status: url.searchParams.get('status'),
        plan: url.searchParams.get('plan'),
        search: url.searchParams.get('search'),
      };

      const tenants = await listAllTenants(filters);
      sendJson(res, 200, { tenants });
    } catch (err) {
      logger.error('Erro ao listar tenants (Super Admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // GET /super-admin/ai-generations - Lista gerações por IA (audit store JSONL)
  if (method === 'GET' && pathname === '/super-admin/ai-generations') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return true;
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const domain = url.searchParams.get('domain');
      const validParam = url.searchParams.get('valid');
      const valid = validParam === null ? undefined : (validParam === 'true');
      const startDate = url.searchParams.get('startDate') || null;
      const endDate = url.searchParams.get('endDate') || null;
      const limit = url.searchParams.get('limit') || '200';

      const { listAiGenerations } = require('../qa/aiGenerationStore');
      const result = listAiGenerations({
        ...(domain ? { domain } : {}),
        ...(valid !== undefined ? { valid } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        limit,
      });
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao listar gerações por IA (Super Admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // GET /super-admin/tenants/:id/metrics - Obtém métricas detalhadas de um tenant
  if (method === 'GET' && pathname.includes('/metrics') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/metrics', ''));
    const metrics = getTenantMetrics(tenantId);

    if (!metrics) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return true;
    }

    sendJson(res, 200, { metrics });
    return true;
  }

  // POST /super-admin/impersonate - Impersona um usuário
  if (method === 'POST' && pathname === '/super-admin/impersonate') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode impersonar usuários' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.agentId) {
        badRequest(res, 'Campo "agentId" é obrigatório');
        return true;
      }

      const result = impersonateUser(body.agentId, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: 'system',
        action: 'impersonate_user',
        resource: 'agent',
        resourceId: body.agentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao impersonar usuário:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /super-admin/tenants/:id/block - Bloqueia um tenant
  if (method === 'POST' && pathname.includes('/block') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode bloquear tenants' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/block', ''));

    try {
      const body = await parseJsonBody(req);
      const reason = body.reason || 'Bloqueado por Super Admin';

      const result = blockTenant(tenantId, reason, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao bloquear tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /super-admin/tenants/:id/unblock - Desbloqueia um tenant
  if (method === 'POST' && pathname.includes('/unblock') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode desbloquear tenants' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/unblock', ''));

    const result = unblockTenant(tenantId, req.agent.id);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, { tenant: result.tenant });
    return true;
  }

  // POST /super-admin/tenants/:id/adjust-plan - Ajusta plano de um tenant
  if (method === 'POST' && pathname.includes('/adjust-plan') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode ajustar planos' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/adjust-plan', ''));

    try {
      const body = await parseJsonBody(req);
      if (!body.plan) {
        badRequest(res, 'Campo "plan" é obrigatório');
        return true;
      }

      const result = adjustTenantPlan(tenantId, body.plan, body.customLimits, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao ajustar plano:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleSuperAdminRoutes };

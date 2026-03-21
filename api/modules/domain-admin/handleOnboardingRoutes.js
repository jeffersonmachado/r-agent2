async function handleOnboardingRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    getOnboardingStatus,
    startOnboarding,
    completeOnboardingStep,
    completeOnboarding,
    createInitialTemplates,
    logAction,
    logger,
  } = deps;

  if (!pathname.startsWith('/onboarding/')) {
    return false;
  }

  // GET /onboarding/status
  if (method === 'GET' && pathname === '/onboarding/status') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return true;
    }

    const status = getOnboardingStatus(req.tenantId);
    if (!status) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return true;
    }

    sendJson(res, 200, { onboarding: status });
    return true;
  }

  // POST /onboarding/start
  if (method === 'POST' && pathname === '/onboarding/start') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return true;
    }

    if (req.agent.role !== 'owner' && req.agent.role !== 'admin' && req.agent.role !== 'super_admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner, admin ou super_admin podem iniciar onboarding' });
      return true;
    }

    const result = startOnboarding(req.tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, result);
    return true;
  }

  // POST /onboarding/complete-step
  if (method === 'POST' && pathname === '/onboarding/complete-step') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.stepId) {
        badRequest(res, 'Campo "stepId" é obrigatório');
        return true;
      }

      const result = completeOnboardingStep(req.tenantId, body.stepId);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: req.tenantId,
        action: 'onboarding_step_complete',
        resource: 'onboarding',
        resourceId: body.stepId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao completar step de onboarding:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /onboarding/complete
  if (method === 'POST' && pathname === '/onboarding/complete') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return true;
    }

    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem finalizar onboarding' });
      return true;
    }

    const result = await completeOnboarding(req.tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: req.tenantId,
      action: 'onboarding_complete',
      resource: 'onboarding',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, result);
    return true;
  }

  // POST /onboarding/create-templates
  if (method === 'POST' && pathname === '/onboarding/create-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!req.tenantId) {
      sendJson(res, 403, { error: 'tenant_id_required' });
      return true;
    }

    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem criar templates' });
      return true;
    }

    let options = {};
    if (hasJsonContentType(req)) {
      try {
        const body = await parseJsonBody(req);
        if (body && typeof body === 'object') {
          if (body.segment) options.segment = String(body.segment);
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          badRequest(res, 'JSON inválido no corpo da requisição');
          return true;
        }
      }
    }

    const result = await createInitialTemplates(req.tenantId, options);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = { handleOnboardingRoutes };

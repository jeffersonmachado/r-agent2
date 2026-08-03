/**
 * Flow Execution Routes Handler
 * Handles: POST /flows/simulate, POST /flows/:id/resolve-dependencies,
 *          POST /flows/:id/preview-rpa, POST /flows/:id/generate-rpa, GET /replay/:sessionId
 * Manages: Flow simulation, RPA pipeline execution, session replay
 */

async function handleFlowExecutionRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    validateFlow,
    flows,
    rpaDependencyResolver,
    previewRpaFlowPipeline,
    executeRpaFlowPipeline,
    simulateFlow,
    sessionEvents,
    sessionTenants,
    saveSessionEventsToFile,
    buildConversationReplay,
    requireAuth,
  } = deps;

  if (!pathname.startsWith('/flows') && !pathname.startsWith('/replay/')) {
    return false;
  }

  if (method === 'POST' && pathname === '/flows/simulate') {
    // Carrega fluxo persistido do tenant (flows.get) — exige autenticação
    // ANTES de qualquer acesso ao store (mesma classe do /flows/preview).
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { flowId, ...options } = body || {};

      if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
        badRequest(res, 'Campo "flowId" e obrigatorio e deve ser uma string nao vazia');
        return true;
      }

      if (options.maxSteps !== undefined) {
        if (typeof options.maxSteps !== 'number' || !Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 1000) {
          badRequest(res, 'Campo "maxSteps" deve ser um numero inteiro entre 1 e 1000');
          return true;
        }
      }

      const flow = flows.get(flowId.trim());
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" nao encontrado` });
        return true;
      }

      const validationResult = validateFlow(flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'flow_invalid',
          message: 'O fluxo nao passou na validacao e nao pode ser simulado',
          errors: validationResult.errors,
        });
        return true;
      }

      const result = await simulateFlow(flow, options || {});

      const sessionId =
        result &&
        result.replay &&
        typeof result.replay.sessionId === 'string'
          ? result.replay.sessionId
          : null;

      if (sessionId) {
        sessionEvents.set(sessionId, Array.isArray(result.events) ? result.events : []);
        // Carimbo de tenant: sem ele o replay fica fail-closed nos readers.
        if (sessionTenants && typeof sessionTenants.set === 'function') {
          const sessionTenantId = flow.tenantId || req.tenantId || null;
          if (sessionTenantId) sessionTenants.set(sessionId, sessionTenantId);
        }
        saveSessionEventsToFile();
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else if (err.message && err.message.includes('excede o tamanho maximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao simular fluxo', err);
        sendJson(res, 500, {
          error: 'simulation_error',
          message: err && err.message ? err.message : 'Erro interno ao simular fluxo',
        });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/flows\/[^/]+\/resolve-dependencies$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);

      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" nao encontrado` });
        return true;
      }

      const tenantId = flow.tenantId || req.tenantId;
      const resolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);

      sendJson(res, 200, resolution);
    } catch (err) {
      logger.error('Erro ao resolver dependencias:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao resolver dependencias' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/flows\/[^/]+\/preview-rpa$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);

      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" nao encontrado` });
        return true;
      }

      const preview = await previewRpaFlowPipeline(flow);

      sendJson(res, 200, preview);
    } catch (err) {
      logger.error('Erro ao gerar preview RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar preview RPA' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/flows\/[^/]+\/generate-rpa$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);

      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" nao encontrado` });
        return true;
      }

      const options = {
        autoExecuteSeeds: body.autoExecuteSeeds || false,
        saveRecording: body.saveRecording !== false,
      };

      const result = await executeRpaFlowPipeline(flow, options);

      if (result.success) {
        sendJson(res, 200, result);
      } else {
        sendJson(res, 400, result);
      }
    } catch (err) {
      logger.error('Erro ao gerar gravacao RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar gravacao RPA' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/replay/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const sessionId = decodeURIComponent(pathname.slice('/replay/'.length));
    const events = sessionEvents.get(sessionId);
    // Isolamento por tenant: sessão sem carimbo ou de outro tenant responde
    // 404 — nunca vaza existência nem conteúdo cross-tenant.
    const stampedTenant = sessionTenants && typeof sessionTenants.get === 'function'
      ? sessionTenants.get(sessionId)
      : null;
    if (!events || !stampedTenant || stampedTenant !== req.tenantId) {
      sendJson(res, 404, { error: 'session_not_found' });
      return true;
    }

    const replay = buildConversationReplay(events);
    sendJson(res, 200, replay);
    return true;
  }

  return false;
}

module.exports = { handleFlowExecutionRoutes };

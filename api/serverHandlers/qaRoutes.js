// QA Routes - Qualidade e Validação de Sistema
async function handleQaRoutes({
  req, res, method, pathname,
  deps: {
    requireAuth, requirePermission, sendJson, badRequest, hasJsonContentType, parseJsonBody,
    logAction, logger,
    getLatestQaResult, getQaHistory, getQaStatistics, getQaResultById, runQaManual,
  }
}) {
  // GET /qa/latest - Último resultado de QA
  if (method === 'GET' && pathname === '/qa/latest') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const result = getLatestQaResult();
      if (!result) {
        sendJson(res, 404, { error: 'not_found', message: 'Nenhum resultado de QA encontrado' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter último resultado QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
    return true;
  }

  // GET /qa/history - Histórico de resultados de QA
  if (method === 'GET' && pathname === '/qa/history') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const source = url.searchParams.get('source') || undefined;

      const history = getQaHistory({ limit, source });
      sendJson(res, 200, { results: history, count: history.length });
    } catch (error) {
      logger.error('Erro ao obter histórico QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter histórico QA' });
    }
    return true;
  }

  // GET /qa/stats - Estatísticas de QA
  if (method === 'GET' && pathname === '/qa/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const stats = getQaStatistics();
      sendJson(res, 200, stats);
    } catch (error) {
      logger.error('Erro ao obter estatísticas QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estatísticas QA' });
    }
    return true;
  }

  // GET /qa/:id - Resultado de QA por ID (commit ou timestamp)
  if (method === 'GET' && pathname.startsWith('/qa/') && 
      pathname !== '/qa/latest' && pathname !== '/qa/history' && pathname !== '/qa/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const id = pathname.split('/qa/')[1];
      if (!id) {
        badRequest(res, 'ID do resultado QA é obrigatório');
        return true;
      }

      const result = getQaResultById(id);
      if (!result) {
        sendJson(res, 404, { error: 'not_found', message: 'Resultado de QA não encontrado' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter resultado QA por ID:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resultado QA' });
    }
    return true;
  }

  // POST /qa/run - Executa QA manualmente
  if (method === 'POST' && pathname === '/qa/run') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'qa', 'execute');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const changedFiles = body.changedFiles || undefined;
      const source = body.source || 'manual';

      const result = runQaManual({ changedFiles, source });

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'execute',
        resource: 'qa',
        details: { status: result.status, scopes: result.scope },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao executar QA:', error);
      sendJson(res, 500, { error: 'internal_error', message: error.message || 'Erro ao executar QA' });
    }
    return true;
  }

  return false;
}

module.exports = { handleQaRoutes };

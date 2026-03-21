async function handleAuthRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    validateInput,
    schemas,
    ValidationError,
    authLogin,
    loginWithRpaToken,
    validateToken,
    authLogout,
    logoutAllSessions,
    logAction,
    logger,
  } = deps;

  // POST /auth/login - Login de agente
  if (method === 'POST' && pathname === '/auth/login') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      // Validação robusta de input
      let validated;
      try {
        validated = validateInput(body, schemas.login);
      } catch (err) {
        if (err instanceof ValidationError) {
          badRequest(res, err.message);
          return true;
        }
        throw err;
      }

      const { username, password } = validated;

      // Extrai IP e User-Agent
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const result = await authLogin(username, password, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'authentication_failed', message: result.error });
        return true;
      }

      // Registra ação de auditoria
      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: result.agent,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao fazer login:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login' });
      }
    }
    return true;
  }

  // POST /auth/rpa/login - Login RPA usando token exclusivo
  if (method === 'POST' && pathname === '/auth/rpa/login') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const rpaToken = body.token || body.rpaToken;
      const tenantId = body.tenantId;

      if (!rpaToken) {
        badRequest(res, 'Token RPA é obrigatório');
        return true;
      }
      if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      // Extrai IP e User-Agent
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'RPA-Automation';

      const result = await loginWithRpaToken(rpaToken, tenantId, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'rpa_authentication_failed', message: result.error });
        return true;
      }

      // Registra ação de auditoria
      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'rpa_login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: result.agent,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao fazer login RPA:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login RPA' });
      }
    }
    return true;
  }

  // GET /auth/rpa/token - Obtém ou gera token RPA
  if (method === 'GET' && pathname === '/auth/rpa/token') {
    try {
      const rpaTokenManager = require('../../../tests/rpa/utils/rpaTokenManager');
      const token = rpaTokenManager.getOrCreateRpaToken();

      sendJson(res, 200, {
        token,
        message: 'Token RPA obtido com sucesso',
        note: 'Use este token para autenticação RPA via POST /auth/rpa/login',
      });
    } catch (err) {
      logger.error('Erro ao obter token RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter token RPA' });
    }
    return true;
  }

  // POST /auth/logout - Logout de agente
  if (method === 'POST' && pathname === '/auth/logout') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return true;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      // Mesmo com token inválido, tenta fazer logout (idempotente)
      authLogout(token);
      sendJson(res, 200, { success: true, message: 'Logout realizado' });
      return true;
    }

    // Registra ação de auditoria
    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout',
      resource: 'auth',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const result = authLogout(token);
    sendJson(res, 200, { success: result.success });
    return true;
  }

  // POST /auth/logout-all - Logout de todas as sessões do agente
  if (method === 'POST' && pathname === '/auth/logout-all') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return true;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return true;
    }

    // Registra ação de auditoria
    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout_all',
      resource: 'auth',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const removed = logoutAllSessions(validation.agent.id);
    sendJson(res, 200, {
      success: true,
      message: `Todas as sessões foram encerradas`,
      sessionsRemoved: removed,
    });
    return true;
  }

  // GET /auth/me - Obtém informações do agente autenticado
  if (method === 'GET' && pathname === '/auth/me') {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return true;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return true;
    }

    sendJson(res, 200, { agent: validation.agent });
    return true;
  }

  return false;
}

module.exports = {
  handleAuthRoutes,
};

async function handleAgentMfaRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    setupMfa,
    verifyMfa,
    disableMfa,
    consumeRecoveryCode,
    logger,
  } = deps;

  // POST /auth/mfa/setup
  if (method === 'POST' && pathname === '/auth/mfa/setup') {
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
      const issuer = body && body.issuer ? String(body.issuer).trim() : null;
      const label = body && body.label ? String(body.label).trim() : null;

      const result = await setupMfa({ agentId: req.agent.id, issuer, label });

      if (!result.ok) {
        sendJson(res, 400, { error: result.error || 'mfa_setup_failed' });
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao iniciar MFA:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // POST /auth/mfa/verify
  if (method === 'POST' && pathname === '/auth/mfa/verify') {
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
      const token = body && body.token ? String(body.token).trim() : '';
      if (!token) {
        badRequest(res, 'token é obrigatório');
        return true;
      }

      const result = await verifyMfa({ agentId: req.agent.id, token });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || 'mfa_verify_failed' });
        return true;
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao confirmar MFA:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // POST /auth/mfa/disable
  if (method === 'POST' && pathname === '/auth/mfa/disable') {
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
      const token = body && body.token ? String(body.token).trim() : null;
      const recoveryCode = body && body.recoveryCode ? String(body.recoveryCode).trim() : null;
      if (!token && !recoveryCode) {
        badRequest(res, 'token ou recoveryCode é obrigatório');
        return true;
      }

      const result = await disableMfa({ agentId: req.agent.id, token, recoveryCode });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || 'mfa_disable_failed' });
        return true;
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao desativar MFA:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // POST /auth/mfa/recovery
  if (method === 'POST' && pathname === '/auth/mfa/recovery') {
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
      const code = body && body.code ? String(body.code).trim() : '';
      if (!code) {
        badRequest(res, 'code é obrigatório');
        return true;
      }

      const result = await consumeRecoveryCode({ agentId: req.agent.id, code });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || 'mfa_recovery_failed' });
        return true;
      }

      sendJson(res, 200, { ok: true, remaining: result.remaining });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao consumir recovery code:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleAgentMfaRoutes };

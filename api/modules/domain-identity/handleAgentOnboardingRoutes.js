async function handleAgentOnboardingRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    inviteUser,
    acceptInvitation,
    requestPasswordReset,
    resetPassword,
    logAction,
    logger,
    checkRateLimit,
  } = deps;

  function getOnboardingIp() {
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  }

  /**
   * Anti brute-force dos endpoints pré-autenticação de onboarding
   * (accept-invitation, request/reset-password): limita por IP via política
   * AUTH_PUBLIC. Retorna true quando o fluxo pode prosseguir; responde 429 e
   * retorna false quando o limite foi excedido.
   */
  async function allowAuthPublicRequest() {
    const rl = await checkRateLimit({ userId: `ip:${getOnboardingIp()}`, operationType: 'AUTH_PUBLIC' });
    if (rl.allowed) return true;
    const retryAfter = rl.retryAfter || 60;
    res.setHeader('Retry-After', retryAfter);
    sendJson(res, 429, {
      error: 'rate_limit_exceeded',
      message: `Limite de requisições excedido. Tente novamente em ${retryAfter} segundos.`,
      retryAfter,
    });
    return false;
  }

  // POST /auth/invite
  if (method === 'POST' && pathname === '/auth/invite') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'invite');
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
      body.tenantId = req.tenantId || body.tenantId;

      const result = await inviteUser(body);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: req.tenantId,
        action: 'user_invite',
        resource: 'agent',
        resourceId: result.agentId,
        details: { email: body.email, role: body.role },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao convidar usuário:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /auth/accept-invitation
  if (method === 'POST' && pathname === '/auth/accept-invitation') {
    if (!(await allowAuthPublicRequest())) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.invitationToken || !body.password || !body.username) {
        badRequest(res, 'invitationToken, password e username são obrigatórios');
        return true;
      }

      const result = await acceptInvitation(body.invitationToken, body.password, body.username);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      if (result.token) {
        res.setHeader('Set-Cookie', `auth_token=${result.token}; HttpOnly; Secure; SameSite=Strict`);
      }

      logAction({
        agentId: result.agent?.id || 'system',
        username: result.agent?.username || body.username,
        tenantId: result.agent?.tenantId || 'unknown',
        action: 'invitation_accepted',
        resource: 'agent',
        resourceId: result.agent?.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao aceitar convite:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /auth/request-password-reset
  if (method === 'POST' && pathname === '/auth/request-password-reset') {
    if (!(await allowAuthPublicRequest())) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.email) {
        badRequest(res, 'Email é obrigatório');
        return true;
      }

      await requestPasswordReset(body.email);
      sendJson(res, 200, {
        success: true,
        message: 'Se o email existir, um link de reset será enviado',
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao solicitar reset de senha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /auth/reset-password
  if (method === 'POST' && pathname === '/auth/reset-password') {
    if (!(await allowAuthPublicRequest())) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.resetToken || !body.newPassword) {
        badRequest(res, 'resetToken e newPassword são obrigatórios');
        return true;
      }

      const result = await resetPassword(body.resetToken, body.newPassword);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Senha resetada com sucesso' });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao resetar senha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleAgentOnboardingRoutes };

async function handleAgentRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    listAgents,
    createAgent,
    getAgent,
    updateAgent,
    deleteAgent,
    inviteUser,
    acceptInvitation,
    requestPasswordReset,
    resetPassword,
    setupMfa,
    verifyMfa,
    disableMfa,
    consumeRecoveryCode,
    isSuperAdmin,
    logAction,
    logger,
  } = deps;

  // GET /auth/agents
  if (method === 'GET' && pathname === '/auth/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'list_all');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const agents = await listAgents(req.tenantId);
    sendJson(res, 200, { agents });
    return true;
  }

  // POST /auth/agents
  if (method === 'POST' && pathname === '/auth/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'create');
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
      body.tenantId = req.tenantId;
      const result = await createAgent(body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'agent_create',
        resource: 'agent',
        resourceId: result.agent.id,
        details: { createdAgent: result.agent.username },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { agent: result.agent });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar agente:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // GET /auth/agents/:id
  if (method === 'GET' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));

    if (req.agent.role !== 'admin' && req.agent.role !== 'supervisor' && req.agent.id !== agentId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver seu próprio perfil' });
      return true;
    }

    const agent = await getAgent(agentId);
    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return true;
    }

    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return true;
    }

    sendJson(res, 200, { agent });
    return true;
  }

  // PUT /auth/agents/:id
  if (method === 'PUT' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));
    const agent = await getAgent(agentId);

    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return true;
    }

    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return true;
    }

    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.role !== 'supervisor' && req.agent.id !== agentId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode atualizar seu próprio perfil' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      if (req.agent.role === 'agent' && agentId === req.agent.id) {
        delete body.role;
        delete body.active;
      }

      const result = await updateAgent(agentId, body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'agent_update',
        resource: 'agent',
        resourceId: agentId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { agent: result.agent });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar agente:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /auth/agents/:id
  if (method === 'DELETE' && pathname.startsWith('/auth/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const agentId = decodeURIComponent(pathname.slice('/auth/agents/'.length));
    const agent = await getAgent(agentId);

    if (!agent) {
      sendJson(res, 404, { error: 'agent_not_found' });
      return true;
    }

    if (req.tenantId && agent.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
      return true;
    }

    const result = await deleteAgent(agentId);

    if (!result.success) {
      badRequest(res, result.error);
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'agent_delete',
      resource: 'agent',
      resourceId: agentId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return true;
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

module.exports = { handleAgentRoutes };

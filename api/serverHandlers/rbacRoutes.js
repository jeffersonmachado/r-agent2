module.exports = { handleRbacRoutes };

async function handleRbacRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    getRoleDefinitions,
    createRole,
    listPermissions,
    getAgent,
    updateAgent,
  } = deps;

  if (method === 'GET' && pathname === '/rbac/roles') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const roles = getRoleDefinitions();
      sendJson(res, 200, { roles });
    } catch (err) {
      logger.error('Erro ao listar roles:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/rbac/roles') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'config', 'update');
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
      const role = body && body.role ? String(body.role).trim() : '';
      const permissions = body && Array.isArray(body.permissions) ? body.permissions : [];

      const result = createRole(role, permissions);
      if (!result.success) {
        sendJson(res, 400, { error: 'invalid_role', message: result.error });
        return true;
      }

      sendJson(res, 201, { role: result.role, permissions: result.permissions });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar role:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  if (method === 'GET' && pathname === '/rbac/permissions') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const permissions = listPermissions();
      sendJson(res, 200, { permissions });
    } catch (err) {
      logger.error('Erro ao listar permissões:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/rbac/assign') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'agents', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const agentId = body && body.agentId ? String(body.agentId).trim() : '';
      const role = body && body.role ? String(body.role).trim() : '';
      if (!agentId || !role) {
        badRequest(res, 'agentId e role são obrigatórios');
        return true;
      }

      const target = await getAgent(agentId);
      if (!target) {
        sendJson(res, 404, { error: 'agent_not_found' });
        return true;
      }

      if (target.tenantId && target.tenantId !== tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Agente não pertence ao seu tenant' });
        return true;
      }

      const result = await updateAgent(agentId, { role });
      if (!result.success) {
        sendJson(res, 400, { error: 'update_failed', message: result.error });
        return true;
      }

      sendJson(res, 200, { agent: result.agent });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atribuir role:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  return false;
}
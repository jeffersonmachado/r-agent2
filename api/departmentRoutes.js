const {
  listDepartments,
  getDepartment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  addAgentToDepartment,
  removeAgentFromDepartment,
} = require('./services/departmentsService');

module.exports = {
  handleDepartmentRoutes,
};

async function handleDepartmentRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  } = deps;

  const requireTenant = (req, res) => {
    const tenantId = req.tenantId || (req.agent && req.agent.tenantId);
    if (!tenantId) {
      sendJson(res, 400, { error: 'tenant_required', message: 'Tenant ID não encontrado' });
      return null;
    }
    return tenantId;
  };

  // Departamentos
  // -----------------------------------------------------------------------

  // GET /departments - Lista departamentos
  if (method === 'GET' && pathname === '/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      tenantId: authResult.agent.tenantId,
      activeOnly: urlObj.searchParams.get('activeOnly') !== 'false',
      agentId: urlObj.searchParams.get('agentId') || undefined,
    };

    const departments = listDepartments(filters);
    sendJson(res, 200, { departments });
    return true;
  }

  // GET /departments/:id - Obtém departamento específico
  if (method === 'GET' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const id = decodeURIComponent(pathname.slice('/departments/'.length));
    const department = getDepartment(id, tenantId);

    if (!department) {
      sendJson(res, 404, { error: 'department_not_found' });
      return true;
    }

    sendJson(res, 200, { department });
    return true;
  }

  // POST /departments - Cria departamento
  if (method === 'POST' && pathname === '/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'departments', 'create');
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
      const result = createDepartment({
        ...body,
        tenantId: req.agent.tenantId,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'department_create',
        resource: 'department',
        resourceId: result.department.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // PUT /departments/:id - Atualiza departamento
  if (method === 'PUT' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/departments/'.length));
      const body = await parseJsonBody(req);
      const result = updateDepartment(id, body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'department_update',
        resource: 'department',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /departments/:id - Remove departamento
  if (method === 'DELETE' && pathname.startsWith('/departments/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'departments', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/departments/'.length));
    const result = deleteDepartment(id);

    if (!result.success) {
      badRequest(res, result.error);
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'department_delete',
      resource: 'department',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /departments/:id/agents - Adiciona agente ao departamento
  if (method === 'POST' && pathname.startsWith('/departments/') && pathname.endsWith('/agents')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/departments/'.length, -'/agents'.length));
      const body = await parseJsonBody(req);
      const { agentId } = body || {};

      if (!agentId) {
        badRequest(res, 'Campo "agentId" é obrigatório');
        return true;
      }

      const result = addAgentToDepartment(id, agentId);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, result.department);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao adicionar agente ao departamento:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /departments/:id/agents/:agentId - Remove agente do departamento
  if (method === 'DELETE' && pathname.includes('/departments/') && pathname.includes('/agents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'departments', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/');
      const deptIndex = parts.indexOf('departments');
      const agentIndex = parts.indexOf('agents');
      const departmentId = decodeURIComponent(parts[deptIndex + 1]);
      const agentId = decodeURIComponent(parts[agentIndex + 1]);

      const result = removeAgentFromDepartment(departmentId, agentId);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, result.department);
    } catch (err) {
      logger.error('Erro ao remover agente do departamento:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

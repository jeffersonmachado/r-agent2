function ensureConfigPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function parseTaskId(pathname, suffix) {
  return decodeURIComponent(pathname.slice('/tasks/'.length, -suffix.length));
}

async function handleTaskRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/tasks') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const service = require('../services/tasksService');
      const out = await service.listTasks(tenantId);
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'tasks_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, tasks: out.tasks || [] });
    } catch (err) {
      logger.error('[Tasks] Erro ao listar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tarefas' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/tasks') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const title = body && body.title ? String(body.title).trim() : '';
      if (!title) {
        badRequest(res, 'title é obrigatório');
        return true;
      }

      const service = require('../services/tasksService');
      const out = await service.createTask(tenantId, {
        title,
        description: body?.description || '',
        dueAt: body?.dueAt || null,
        priority: body?.priority || 'normal',
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'tasks_unavailable' });
        return true;
      }
      sendJson(res, 201, { ok: true, task: out.task });
    } catch (err) {
      logger.error('[Tasks] Erro ao criar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar tarefa' });
    }

    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tasks/') && pathname.endsWith('/complete')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const id = parseTaskId(pathname, '/complete');
      const service = require('../services/tasksService');
      const out = await service.completeTask(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Tarefa não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'tasks_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, task: out.task });
    } catch (err) {
      logger.error('[Tasks] Erro ao completar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao completar tarefa' });
    }

    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tasks/') && pathname.endsWith('/reminder')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = parseTaskId(pathname, '/reminder');
      const body = await parseJsonBody(req);
      const reminderAt = body && body.reminderAt ? String(body.reminderAt) : null;
      const service = require('../services/tasksService');
      const out = await service.scheduleReminder(tenantId, id, reminderAt);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Tarefa não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'tasks_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, task: out.task });
    } catch (err) {
      logger.error('[Tasks] Erro ao agendar lembrete:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao agendar lembrete' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleTaskRoutes,
};

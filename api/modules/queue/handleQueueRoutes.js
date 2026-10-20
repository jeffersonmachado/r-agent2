async function handleQueueRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    listQueues,
    createQueue,
    getQueueInfo,
    deleteQueue,
    listQueue,
    canAccessTicket,
    queueDefinitionService,
    logAction,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'queues', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const legacy = listQueues(req.tenantId) || [];
    const defs = queueDefinitionService.listQueues({ tenantId: req.tenantId }).map((q) => q.name);
    const merged = Array.from(new Set([...legacy, ...defs])).sort();
    sendJson(res, 200, merged);
    return true;
  }

  // POST /queues - Cria uma nova fila
  if (method === 'POST' && pathname === '/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'queues', 'create');
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
      const queueName = body && body.name ? String(body.name) : null;

      if (!queueName) {
        badRequest(res, 'Campo "name" é obrigatório');
        return true;
      }

      const result = createQueue(queueName);

      if (result.success) {
        // Mesma correção do caminho via service (ver
        // api/modules/queue/service.js): o upsert NÃO pode ser fire-and-forget.
        // Com o `.catch(() => {})` anterior, o DELETE do cenário
        // `business-core-biz-queues` corria à frente do upsert e a fila
        // reaparecia na listagem (mesh 2026-10-19T17-34-30).
        const persistencia = await queueDefinitionService.upsertQueue({
          tenantId: req.tenantId,
          name: result.queueName,
          routingStrategy: 'manual',
          priority: 0,
          active: true,
        });

        if (persistencia && persistencia.success === false) {
          // Compensação ESCOPADA (mesmo P0 do caminho via service): só reverte o
          // que ESTA operação criou, nunca fila preexistente, e nunca com force
          // (force fecha tickets ativos).
          if (result.created === true) {
            try {
              deleteQueue(result.queueName, false, { tenantId: req.tenantId });
            } catch (_) {
              /* rollback best-effort; o erro real é reportado abaixo */
            }
          } else {
            logger.error('Persistência falhou em fila preexistente — estado anterior preservado', {
              queueName: result.queueName,
              error: (persistencia && persistencia.error) || null,
            });
          }
          logger.error('Erro ao persistir definição da fila', {
            queueName: result.queueName,
            error: (persistencia && persistencia.error) || null,
          });
          sendJson(res, 500, {
            error: 'persistence_required',
            message: `Fila não persistida: ${(persistencia && persistencia.error) || 'erro desconhecido'}`,
          });
          return true;
        }

        logAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'queue_create',
          resource: 'queue',
          resourceId: result.queueName,
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        sendJson(res, result.message === 'Fila já existe' ? 200 : 201, result);
      } else {
        badRequest(res, result.message);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar fila', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return true;
  }

  // GET /queues/:name - Obtém informações sobre uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'queues', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const info = getQueueInfo(queueName, { tenantId: req.tenantId });

    if (info === null) {
      badRequest(res, 'Nome da fila inválido');
      return true;
    }

    sendJson(res, 200, info);
    return true;
  }

  // DELETE /queues/:name - Exclui uma fila
  if (method === 'DELETE' && pathname.startsWith('/queues/') && !pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'queues', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const queueName = decodeURIComponent(pathname.slice('/queues/'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const force = urlObj.searchParams.get('force') === 'true';

    const result = deleteQueue(queueName, force, { tenantId: req.tenantId });

    if (result.success) {
      // A definição persistida da fila precisa ser desativada junto: GET /queues
      // mescla o serviço legado (memória) com queueDefinitionService (DB) e a
      // fila "excluída" reapareceria na listagem e após restart. Aguardado
      // para não haver corrida com listagens imediatamente posteriores.
      try {
        const existing = typeof queueDefinitionService.getQueueByName === 'function'
          ? queueDefinitionService.getQueueByName(req.tenantId, queueName)
          : null;
        await queueDefinitionService.upsertQueue({
          tenantId: req.tenantId,
          name: queueName,
          routingStrategy: existing?.routingStrategy || 'manual',
          priority: existing?.priority ?? 0,
          active: false,
        });
      } catch (err) {
        logger.error('Erro ao desativar definição persistida da fila', err);
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'queue_delete',
        resource: 'queue',
        resourceId: queueName,
        details: { force, deletedTickets: result.deletedTickets || 0 },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } else {
      if (result.message.includes('não encontrada')) {
        sendJson(res, 404, result);
      } else {
        sendJson(res, 400, result);
      }
    }
    return true;
  }

  // GET /queues/:queue/tickets - Lista tickets de uma fila
  if (method === 'GET' && pathname.startsWith('/queues/') && pathname.endsWith('/tickets')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const queue = decodeURIComponent(pathname.slice('/queues/'.length, -'/tickets'.length));
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status');

    let tickets = listQueue(queue, {
      tenantId: req.tenantId,
      ...(status ? { status } : {}),
    });

    if (req.agent.role === 'agent') {
      tickets = tickets.filter((ticket) => canAccessTicket(req.agent, ticket));
    }

    sendJson(res, 200, tickets);
    return true;
  }

  return false;
}

module.exports = {
  handleQueueRoutes,
};

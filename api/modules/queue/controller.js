'use strict';

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

function createQueueController({ service, deps }) {
  function ensurePermission(req, res, resource, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }

    return true;
  }

  function bestEffortLogAction(payload) {
    try {
      deps.logAction(payload);
    } catch (_) {}
  }

  return {
    async list(req, res) {
      if (!ensurePermission(req, res, 'queues', 'read')) return;
      const merged = service.listQueues(req.tenantId);
      deps.sendJson(res, 200, merged);
    },

    async create(req, res) {
      if (!ensurePermission(req, res, 'queues', 'create')) return;

      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }

      try {
        const payload = service.parseCreatePayload(await deps.parseJsonBody(req));
        if (!payload.name) {
          deps.badRequest(res, 'Campo "name" é obrigatório');
          return;
        }

        const result = await service.createQueue(req, payload.name);
        if (result.success) {
          bestEffortLogAction({
            agentId: req.agent.id,
            username: req.agent.username,
            action: 'queue_create',
            resource: 'queue',
            resourceId: result.queueName,
            ipAddress: getIpAddress(req),
            userAgent: req.headers['user-agent'] || 'unknown',
          });

          deps.sendJson(res, result.message === 'Fila já existe' ? 200 : 201, result);
          return;
        }

        deps.badRequest(res, result.message);
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }

        deps.logger.error('Erro ao criar fila', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    },

    async getInfo(req, res) {
      if (!ensurePermission(req, res, 'queues', 'read')) return;

      const queueName = decodeURIComponent(String(req.params.queueName));
      const info = service.getQueueInfo(queueName);
      if (info === null) {
        deps.badRequest(res, 'Nome da fila inválido');
        return;
      }

      deps.sendJson(res, 200, info);
    },

    async remove(req, res) {
      if (!ensurePermission(req, res, 'queues', 'delete')) return;

      const queueName = decodeURIComponent(String(req.params.queueName));
      const { force } = service.parseDeleteOptions(req.url);
      const result = await service.deleteQueue(queueName, force, req.tenantId);

      if (result.success) {
        bestEffortLogAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'queue_delete',
          resource: 'queue',
          resourceId: queueName,
          details: { force, deletedTickets: result.deletedTickets || 0 },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        deps.sendJson(res, 200, result);
        return;
      }

      if (result.message.includes('não encontrada')) {
        deps.sendJson(res, 404, result);
        return;
      }

      deps.sendJson(res, 400, result);
    },

    async listTickets(req, res) {
      if (!ensurePermission(req, res, 'tickets', 'read')) return;

      const queueName = decodeURIComponent(String(req.params.queueName));
      const { status } = service.parseTicketFilters(req.url);

      let tickets = service.listQueueTickets(queueName, {
        tenantId: req.tenantId,
        ...(status ? { status } : {}),
      });

      if (req.agent.role === 'agent') {
        tickets = tickets.filter((ticket) => deps.canAccessTicket(req.agent, ticket));
      }

      deps.sendJson(res, 200, tickets);
    },
  };
}

module.exports = {
  createQueueController,
};

const {
  createInternalErrorResponder,
  ensureQueuePermission,
  ensureTicketPermission,
  getTicketAndValidateAccess,
  logTicketAction,
  parseTicketRouteId,
} = require('./ticketRouteUtils');

async function handleTicketOperationsRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota operacional de tickets');

  if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const id = parseTicketRouteId(pathname, '/ai-summary');
      const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
      if (!ticket) return true;

      const result = deps.ticketInsightService.getAiSummary(id);
      if (!result.success) {
        deps.sendJson(res, 404, { error: result.error });
        return true;
      }
      deps.sendJson(res, 200, { summary: result.summary });
    } catch (err) {
      return respondInternalError(err, { logMessage: 'Erro ao obter ai-summary:' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const id = parseTicketRouteId(pathname, '/ai-summary');
      const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
      if (!ticket) return true;

      const result = await deps.ticketInsightService.generateAiSummary({
        ticketId: id,
        tenantId: req.tenantId,
        agent: req.agent,
      });

      if (!result.success) {
        deps.sendJson(res, 400, { error: result.error });
        return true;
      }

      deps.sendJson(res, 200, { summary: result.summary });
    } catch (err) {
      return respondInternalError(err, { logMessage: 'Erro ao gerar ai-summary:' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/queues/reload') {
    if (!ensureQueuePermission({ req, res, deps, permission: 'admin' })) return true;

    try {
      deps.logger.info('Recarregando dados de filas e tickets do arquivo...');
      const allTicketsBefore = deps.listAllTickets();
      const queuesBefore = deps.listQueues();
      const ticketsBefore = allTicketsBefore.tickets.length;
      const queuesCountBefore = queuesBefore.length;
      const allTicketsAfter = deps.listAllTickets();
      const queuesAfter = deps.listQueues();
      const ticketsAfter = allTicketsAfter.tickets.length;
      const queuesCountAfter = queuesAfter.length;

      deps.logger.info('Dados recarregados com sucesso', {
        ticketsAntes: ticketsBefore,
        ticketsDepois: ticketsAfter,
        filasAntes: queuesCountBefore,
        filasDepois: queuesCountAfter,
      });

      logTicketAction({
        req,
        deps,
        action: 'queue_reload',
        resource: 'queue',
        details: {
          before: { tickets: ticketsBefore, queues: queuesCountBefore },
          after: { tickets: ticketsAfter, queues: queuesCountAfter },
        },
      });

      deps.sendJson(res, 200, {
        success: true,
        message: 'Dados recarregados com sucesso',
        before: {
          tickets: ticketsBefore,
          queues: queuesCountBefore,
        },
        after: {
          tickets: ticketsAfter,
          queues: queuesCountAfter,
        },
      });
    } catch (error) {
      deps.logger.error('Erro ao recarregar dados', error);
      deps.sendJson(res, 500, {
        success: false,
        error: 'Erro ao recarregar dados',
        message: error.message,
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/metrics/queues') {
    if (!ensureQueuePermission({ req, res, deps, permission: 'read' })) return true;

    try {
      deps.logger.info('Endpoint /metrics/queues chamado');
      const metrics = deps.getMetrics();
      deps.logger.info('Métricas retornadas', {
        totalTickets: metrics.totalTickets,
        ticketsByStatus: metrics.ticketsByStatus,
        ticketsByQueue: Object.keys(metrics.ticketsByQueue).length,
        queueDetails: metrics.ticketsByQueue,
      });

      deps.sendJson(res, 200, {
        ...metrics,
        _timestamp: Date.now(),
      });
    } catch (error) {
      deps.logger.error('Erro ao obter métricas', error);
      deps.sendJson(res, 500, { error: 'Erro ao obter métricas', message: error.message });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleTicketOperationsRoutes,
};

'use strict';

function mergeQueueNames({ legacyQueues, storedQueues }) {
  return Array.from(new Set([...(legacyQueues || []), ...(storedQueues || [])])).sort();
}

function parseCreatePayload(body) {
  return {
    name: body && body.name ? String(body.name) : null,
  };
}

function parseDeleteOptions(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  return {
    force: urlObj.searchParams.get('force') === 'true',
  };
}

function parseTicketFilters(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  return {
    status: urlObj.searchParams.get('status'),
  };
}

function createQueueService({ deps }) {
  return {
    parseCreatePayload,
    parseDeleteOptions,
    parseTicketFilters,

    listQueues(tenantId) {
      const legacyQueues = deps.listQueues() || [];
      const storedQueues = deps.queueDefinitionService
        .listQueues({ tenantId })
        .map((queue) => queue.name);

      return mergeQueueNames({ legacyQueues, storedQueues });
    },

    async createQueue(req, queueName) {
      const result = deps.createQueue(queueName);

      if (result.success) {
        deps.queueDefinitionService.upsertQueue({
          tenantId: req.tenantId,
          name: result.queueName,
          routingStrategy: 'manual',
          priority: 0,
          active: true,
        }).catch(() => {});
      }

      return result;
    },

    getQueueInfo(queueName) {
      return deps.getQueueInfo(queueName);
    },

    async deleteQueue(queueName, force, tenantId = null) {
      const result = deps.deleteQueue(queueName, force);

      if (result.success && tenantId) {
        // A definição persistida da fila precisa ser desativada junto: a
        // listagem mescla o serviço legado (memória) com o
        // queueDefinitionService (DB) e a fila "excluída" reapareceria.
        // Aguardado (não fire-and-forget) para não haver corrida entre a
        // exclusão e uma listagem imediatamente posterior.
        try {
          const existing = typeof deps.queueDefinitionService.getQueueByName === 'function'
            ? deps.queueDefinitionService.getQueueByName(tenantId, queueName)
            : null;
          await deps.queueDefinitionService.upsertQueue({
            tenantId,
            name: queueName,
            routingStrategy: existing?.routingStrategy || 'manual',
            priority: existing?.priority ?? 0,
            active: false,
          });
        } catch (err) {
          deps.logger.error('Erro ao desativar definição persistida da fila', err);
        }
      }

      return result;
    },

    listQueueTickets(queueName, options) {
      return deps.listQueue(queueName, options);
    },
  };
}

module.exports = {
  createQueueService,
};

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

    deleteQueue(queueName, force) {
      return deps.deleteQueue(queueName, force);
    },

    listQueueTickets(queueName, options) {
      return deps.listQueue(queueName, options);
    },
  };
}

module.exports = {
  createQueueService,
};

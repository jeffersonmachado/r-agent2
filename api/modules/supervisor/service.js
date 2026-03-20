'use strict';

function parseMetricsQuery(req) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  return {
    groupBy: urlObj.searchParams.get('groupBy') || 'agent',
    period: urlObj.searchParams.get('period') || 'day',
    from: urlObj.searchParams.get('from') || undefined,
    to: urlObj.searchParams.get('to') || undefined,
  };
}

function createSupervisorService(deps) {
  return {
    async getMetrics(req, tenantId) {
      const { groupBy, period, from, to } = parseMetricsQuery(req);
      const metrics = await deps.getSupervisorMetrics({
        tenantId,
        groupBy,
        period,
        from,
        to,
      });

      const summary = await deps.getGeneralMetrics({
        tenantId,
        startDate: from || undefined,
        endDate: to || undefined,
      });

      return { summary, ...metrics };
    },

    async getAgentsStatus(tenantId) {
      const agents = await deps.getSupervisorAgentStatus({ tenantId });
      return { agents };
    },

    async getQueuesStatus(tenantId) {
      const queues = await deps.getSupervisorQueueStatus({ tenantId });
      return { queues };
    },
  };
}

module.exports = {
  createSupervisorService,
};

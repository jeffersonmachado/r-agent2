'use strict';

function normalizePolicyBody(body) {
  return {
    id: body?.id || null,
    name: body && body.name ? String(body.name).trim() : '',
    description: body?.description || '',
    customerSegment: body?.customerSegment || 'default',
    responseTimeMin: body?.responseTimeMin,
    resolutionTimeMin: body?.resolutionTimeMin,
    enabled: body?.enabled !== false,
  };
}

function createSlaService({ slaService }) {
  return {
    async listPolicies(tenantId) {
      return slaService.listPolicies(tenantId);
    },

    async listBreaches(tenantId) {
      return slaService.listBreaches(tenantId);
    },

    async upsertPolicy(tenantId, body) {
      const policy = normalizePolicyBody(body);
      if (!policy.name) {
        return {
          ok: false,
          kind: 'bad_request',
          message: 'name é obrigatório',
        };
      }

      const out = await slaService.upsertPolicy(tenantId, policy);
      if (!out.ok) {
        return {
          ok: false,
          kind: 'service_unavailable',
          payload: {
            error: 'service_unavailable',
            message: out.error || 'sla_unavailable',
          },
        };
      }

      return {
        ok: true,
        payload: {
          ok: true,
          policy: out.policy,
        },
      };
    },
  };
}

module.exports = {
  createSlaService,
};

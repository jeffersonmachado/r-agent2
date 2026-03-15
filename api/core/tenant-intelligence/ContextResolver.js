'use strict';

const tenantService = require('../../services/tenantService');
const { TenantGoal } = require('../../db/models');
const { resolvePeriodBounds } = require('./helpers');

class ContextResolver {
  async resolve({ tenantId, period = 'month', filters = {} } = {}) {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    const periodBounds = resolvePeriodBounds(period, filters.period || {});
    const tenantContext = tenantService.getTenantContext(tenantId) || null;

    const GoalModel = TenantGoal();
    const activeGoals = await GoalModel.findAll({
      where: {
        tenant_key: String(tenantId),
        status: 'active',
      },
      order: [['updated_at', 'DESC']],
      limit: 50,
    });

    const goals = (activeGoals || []).map((row) => (row.toJSON ? row.toJSON() : row));

    return {
      tenantId: String(tenantId),
      period: {
        type: periodBounds.type,
        start: periodBounds.start.toISOString(),
        end: periodBounds.end.toISOString(),
      },
      filters: filters || {},
      tenantContext,
      activeGoals: goals,
      strategicProfile: {
        ramoAtividade: tenantContext?.ramo_atividade || null,
        objetivo: tenantContext?.objetivo || null,
        prioridade: tenantContext?.prioridade || 'HIGH',
        escopo: Array.isArray(tenantContext?.escopo) ? tenantContext.escopo : [],
      },
      additionalContext: {
        hasTenantContext: !!tenantContext,
        activeGoalsCount: goals.length,
      },
    };
  }
}

module.exports = {
  ContextResolver,
};

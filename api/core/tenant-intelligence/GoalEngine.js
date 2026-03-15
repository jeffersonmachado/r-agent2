'use strict';

const { TenantGoal } = require('../../db/models');
const { buildId, toNumber, dateOnlyString } = require('./helpers');

class GoalEngine {
  evaluateGoalStatus(goal) {
    const target = toNumber(goal?.target_value, 0);
    const current = goal?.current_value == null ? null : toNumber(goal.current_value, 0);
    const mode = String(goal?.comparison_mode || 'gte').toLowerCase();

    if (current == null || target === 0) {
      return {
        computedStatus: 'unknown',
        progressPercent: null,
        delta: null,
      };
    }

    let meetsTarget = false;
    let progressRatio = 0;

    if (mode === 'lte') {
      meetsTarget = current <= target;
      progressRatio = current === 0 ? 1 : target / Math.max(current, 0.000001);
    } else if (mode === 'eq') {
      meetsTarget = current === target;
      progressRatio = target === 0 ? 1 : 1 - (Math.abs(current - target) / Math.max(Math.abs(target), 1));
    } else {
      meetsTarget = current >= target;
      progressRatio = target === 0 ? 1 : current / target;
    }

    const progressPercent = Math.max(0, Math.min(100, Math.round(progressRatio * 100)));
    const delta = Number((current - target).toFixed(6));

    if (meetsTarget) {
      return { computedStatus: 'on_track', progressPercent, delta };
    }

    if (progressPercent >= 90) {
      return { computedStatus: 'at_risk', progressPercent, delta };
    }

    return { computedStatus: 'off_track', progressPercent, delta };
  }

  async createGoal({ tenantId, payload = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!payload?.name || !payload?.metric_key || payload?.target_value == null) {
      throw new Error('name, metric_key and target_value are required');
    }

    const GoalModel = TenantGoal();
    const record = await GoalModel.create({
      id: buildId('goal'),
      tenant_key: String(tenantId),
      name: String(payload.name).trim(),
      description: payload.description ? String(payload.description) : null,
      metric_key: String(payload.metric_key).trim(),
      target_value: toNumber(payload.target_value, 0),
      current_value: payload.current_value == null ? null : toNumber(payload.current_value, 0),
      comparison_mode: payload.comparison_mode ? String(payload.comparison_mode) : 'gte',
      period_type: payload.period_type ? String(payload.period_type) : 'month',
      start_date: payload.start_date ? dateOnlyString(payload.start_date) : null,
      end_date: payload.end_date ? dateOnlyString(payload.end_date) : null,
      priority: payload.priority ? String(payload.priority) : 'medium',
      status: payload.status ? String(payload.status) : 'active',
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    });

    const goal = record.toJSON ? record.toJSON() : record;
    return {
      goal,
      evaluation: this.evaluateGoalStatus(goal),
    };
  }

  async listGoals({ tenantId, status = null, includeComputed = true, limit = 100 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    const GoalModel = TenantGoal();

    const where = {
      tenant_key: String(tenantId),
    };
    if (status) where.status = String(status);

    const rows = await GoalModel.findAll({
      where,
      order: [['updated_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });

    const items = (rows || []).map((row) => {
      const goal = row.toJSON ? row.toJSON() : row;
      if (!includeComputed) return goal;
      return {
        ...goal,
        computed: this.evaluateGoalStatus(goal),
      };
    });

    return {
      items,
      total: items.length,
    };
  }

  async getGoalById({ tenantId, goalId } = {}) {
    if (!tenantId || !goalId) return null;
    const GoalModel = TenantGoal();
    const row = await GoalModel.findOne({
      where: {
        tenant_key: String(tenantId),
        id: String(goalId),
      },
    });
    if (!row) return null;
    const goal = row.toJSON ? row.toJSON() : row;
    return {
      ...goal,
      computed: this.evaluateGoalStatus(goal),
    };
  }

  async updateGoal({ tenantId, goalId, updates = {} } = {}) {
    if (!tenantId || !goalId) throw new Error('tenantId and goalId are required');

    const GoalModel = TenantGoal();
    const row = await GoalModel.findOne({
      where: {
        tenant_key: String(tenantId),
        id: String(goalId),
      },
    });

    if (!row) {
      return { ok: false, error: 'goal_not_found' };
    }

    const patch = {};
    const allowed = [
      'name',
      'description',
      'metric_key',
      'target_value',
      'current_value',
      'comparison_mode',
      'period_type',
      'start_date',
      'end_date',
      'priority',
      'status',
      'metadata',
    ];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        patch[key] = updates[key];
      }
    }

    if (patch.target_value !== undefined) patch.target_value = toNumber(patch.target_value, 0);
    if (patch.current_value !== undefined) patch.current_value = patch.current_value == null ? null : toNumber(patch.current_value, 0);
    if (patch.start_date !== undefined) patch.start_date = patch.start_date ? dateOnlyString(patch.start_date) : null;
    if (patch.end_date !== undefined) patch.end_date = patch.end_date ? dateOnlyString(patch.end_date) : null;

    await row.update(patch);
    const goal = row.toJSON ? row.toJSON() : row;

    return {
      ok: true,
      goal,
      evaluation: this.evaluateGoalStatus(goal),
    };
  }
}

module.exports = {
  GoalEngine,
};

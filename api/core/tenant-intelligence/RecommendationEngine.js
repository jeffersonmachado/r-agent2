'use strict';

const { TenantRecommendation } = require('../../db/models');
const { buildId } = require('./helpers');

class RecommendationEngine {
  async listRecommendations({ tenantId, status = null, limit = 100 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const RecommendationModel = TenantRecommendation();
    const where = { tenant_key: String(tenantId) };
    if (status) where.status = String(status);

    const rows = await RecommendationModel.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });

    const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    return { items, total: items.length };
  }

  async generateRecommendations({ tenantId, insights = [], goals = [] } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const created = [];
    let skipped = 0;

    for (const insight of insights || []) {
      const mapped = this._mapInsightToRecommendation(insight, goals);
      if (!mapped) continue;

      // eslint-disable-next-line no-await-in-loop
      const existing = await this._findExistingOpenRecommendation({
        tenantId,
        insightId: mapped.insightId,
        actionType: mapped.actionType,
      });

      if (existing) {
        skipped += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const createdItem = await this.createRecommendation({
        tenantId,
        payload: mapped,
      });
      created.push(createdItem);
    }

    return {
      ok: true,
      created: created.length,
      skipped,
      recommendations: created,
    };
  }

  async createRecommendation({ tenantId, payload = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!payload?.title || !payload?.description || !payload?.actionType) {
      throw new Error('title, description and actionType are required');
    }

    const RecommendationModel = TenantRecommendation();
    const row = await RecommendationModel.create({
      id: buildId('reco'),
      tenant_key: String(tenantId),
      insight_id: payload.insightId ? String(payload.insightId) : null,
      goal_id: payload.goalId ? String(payload.goalId) : null,
      title: String(payload.title),
      description: String(payload.description),
      action_type: String(payload.actionType),
      priority: String(payload.priority || 'medium'),
      status: String(payload.status || 'open'),
      estimated_impact: payload.estimatedImpact && typeof payload.estimatedImpact === 'object'
        ? payload.estimatedImpact
        : {},
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    });

    return row.toJSON ? row.toJSON() : row;
  }

  _mapInsightToRecommendation(insight, goals) {
    if (!insight || !insight.id) return null;

    const type = String(insight.type || 'generic_insight');
    const relatedMetrics = Array.isArray(insight.related_metrics) ? insight.related_metrics : [];
    const goalFromInsight = insight.metadata?.goalId || null;
    const matchedGoal = goalFromInsight
      ? (goals || []).find((goal) => String(goal.id) === String(goalFromInsight))
      : null;

    if (type === 'goal_off_track') {
      return {
        insightId: insight.id,
        goalId: matchedGoal?.id || goalFromInsight || null,
        title: 'Revisar operacao para meta fora da faixa',
        description: 'A meta associada ao insight esta fora da faixa esperada. Priorize uma revisao operacional do fluxo que alimenta essa metrica.',
        actionType: 'operational_review',
        priority: matchedGoal?.priority || 'high',
        estimatedImpact: { expected: 'medium', horizon: 'short_term' },
        metadata: {
          sourceInsightType: type,
          relatedMetrics,
        },
      };
    }

    if (type === 'event_concentration') {
      return {
        insightId: insight.id,
        goalId: matchedGoal?.id || null,
        title: 'Investigar concentracao de falhas e aplicar playbook',
        description: 'Foi detectada concentracao relevante de eventos em um mesmo padrao. Recomenda-se investigacao guiada e aplicacao de playbook operacional.',
        actionType: 'investigate_concentration',
        priority: 'high',
        estimatedImpact: { expected: 'high', horizon: 'short_term' },
        metadata: {
          sourceInsightType: type,
          relatedMetrics,
        },
      };
    }

    if (type === 'metric_drop') {
      return {
        insightId: insight.id,
        goalId: matchedGoal?.id || null,
        title: 'Acionar investigacao para queda de metrica',
        description: 'Foi observada queda relevante de metrica. Recomenda-se analise de causa e acao humana prioritaria.',
        actionType: 'investigate_metric_drop',
        priority: 'medium',
        estimatedImpact: { expected: 'medium', horizon: 'short_term' },
        metadata: {
          sourceInsightType: type,
          relatedMetrics,
        },
      };
    }

    if (type === 'metric_increase') {
      return {
        insightId: insight.id,
        goalId: matchedGoal?.id || null,
        title: 'Validar aumento de metrica e ajustar capacidade',
        description: 'Foi observado aumento relevante em metrica operacional. Recomenda-se confirmar origem e ajustar capacidade/processo conforme necessario.',
        actionType: 'validate_metric_increase',
        priority: 'medium',
        estimatedImpact: { expected: 'medium', horizon: 'short_term' },
        metadata: {
          sourceInsightType: type,
          relatedMetrics,
        },
      };
    }

    if (type === 'goal_at_risk') {
      return {
        insightId: insight.id,
        goalId: matchedGoal?.id || goalFromInsight || null,
        title: 'Antecipar acao para meta em risco',
        description: 'A meta associada mostra risco de nao cumprimento. Recomenda-se acao preventiva com dono e prazo definidos.',
        actionType: 'preventive_action',
        priority: 'medium',
        estimatedImpact: { expected: 'medium', horizon: 'short_term' },
        metadata: {
          sourceInsightType: type,
          relatedMetrics,
        },
      };
    }

    return {
      insightId: insight.id,
      goalId: matchedGoal?.id || null,
      title: 'Revisar insight estrategico e definir proximo passo',
      description: 'Existe um insight aberto sem plano de acao explicito. Recomenda-se atribuicao de responsavel e definicao de proximo passo.',
      actionType: 'human_review',
      priority: 'low',
      estimatedImpact: { expected: 'low', horizon: 'short_term' },
      metadata: {
        sourceInsightType: type,
        relatedMetrics,
      },
    };
  }

  async _findExistingOpenRecommendation({ tenantId, insightId, actionType } = {}) {
    if (!tenantId || !insightId || !actionType) return null;

    const RecommendationModel = TenantRecommendation();
    const row = await RecommendationModel.findOne({
      where: {
        tenant_key: String(tenantId),
        insight_id: String(insightId),
        action_type: String(actionType),
        status: 'open',
      },
    });

    return row ? (row.toJSON ? row.toJSON() : row) : null;
  }
}

module.exports = {
  RecommendationEngine,
};

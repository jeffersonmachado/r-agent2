'use strict';

const { TenantRecommendation, TenantInsight, TenantMetricSnapshot } = require('../../db/models');
const { buildId, toNumber } = require('./helpers');

// Direcao esperada do movimento da metrica por tipo de insight de origem.
const OUTCOME_DIRECTION_BY_INSIGHT = {
  metric_drop: 'up',
  goal_off_track: 'up',
  goal_at_risk: 'up',
  metric_increase: 'observe',
  event_concentration: 'down',
};

function buildStatusError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function rowToJson(row) {
  return row && row.toJSON ? row.toJSON() : row;
}

class RecommendationEngine {
  constructor(deps = {}) {
    this._workspaceOperations = deps.workspaceOperations || null;
    this._evidenceEngine = deps.evidenceEngine || null;
  }

  // Lazy defaults: evitam custo/ciclos de require e mantêm os testes de
  // unidade (models mockados) intactos quando a execução não é exercitada.
  get workspaceOperations() {
    if (!this._workspaceOperations) {
      // eslint-disable-next-line global-require
      const WorkspaceOperationsService = require('../../services/workspace/WorkspaceOperationsService');
      this._workspaceOperations = new WorkspaceOperationsService();
    }
    return this._workspaceOperations;
  }

  get evidenceEngine() {
    if (!this._evidenceEngine) {
      // eslint-disable-next-line global-require
      const { EvidenceEngine } = require('./EvidenceEngine');
      this._evidenceEngine = new EvidenceEngine();
    }
    return this._evidenceEngine;
  }

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
      metadata: {
        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        ...(payload.action && typeof payload.action === 'object' ? { action: payload.action } : {}),
      },
    });

    return row.toJSON ? row.toJSON() : row;
  }

  async applyRecommendation({ tenantId, recommendationId, actor } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!recommendationId) throw new Error('recommendationId is required');

    const RecommendationModel = TenantRecommendation();
    const row = await RecommendationModel.findOne({
      where: { id: String(recommendationId), tenant_key: String(tenantId) },
    });
    if (!row) throw buildStatusError('recommendation_not_found', 404);

    const current = rowToJson(row);
    if (current.status !== 'open') throw buildStatusError('recommendation_not_open', 409);

    const metricKeys = await this._resolveBaselineMetricKeys(current);
    const capturedAt = new Date().toISOString();
    const baseline = [];
    for (const metricKey of metricKeys) {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await this._findLatestSnapshot({ tenantId, metricKey });
      baseline.push({
        metricKey,
        value: toNumber(snapshot?.value, 0),
        snapshotId: snapshot?.id || null,
        capturedAt,
      });
    }

    const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
    const expectedDirection = OUTCOME_DIRECTION_BY_INSIGHT[metadata.sourceInsightType] || 'observe';

    // Action real: aplicar uma recomendação executa a ação mapeada (hoje:
    // create_task — investigação/revisão vira tarefa operacional no Workspace).
    // Falha de execução é explícita na resposta e no metadata, sem reverter
    // a decisão de aplicação.
    let execution = null;
    const action = metadata.action && typeof metadata.action === 'object' ? metadata.action : null;
    if (action?.kind === 'create_task') {
      execution = await this._executeCreateTask({ tenantId, recommendation: current, action });
    }

    await row.update({
      status: 'applied',
      metadata: {
        ...metadata,
        application: {
          appliedAt: capturedAt,
          appliedBy: actor || null,
          baseline,
          expectedDirection,
          ...(execution ? { executedAction: execution } : {}),
        },
      },
    });

    return { ok: true, recommendation: rowToJson(row), ...(execution ? { execution } : {}) };
  }

  async _executeCreateTask({ tenantId, recommendation, action }) {
    const attemptedAt = new Date().toISOString();
    try {
      const task = await this.workspaceOperations.createTask({
        tenantId: String(tenantId),
        payload: {
          title: `[Recomendação] ${String(recommendation.title || '').slice(0, 180)}`,
          description: `${recommendation.description || ''}\n\nOrigem: recomendação ${recommendation.id}${recommendation.insight_id ? ` (insight ${recommendation.insight_id})` : ''}`,
          type: 'recommendation',
          priority: recommendation.priority === 'high' ? 'high' : (recommendation.priority === 'low' ? 'low' : 'normal'),
        },
      });
      return {
        kind: 'create_task',
        status: 'executed',
        taskId: task?.id || null,
        label: action.label || null,
        executedAt: attemptedAt,
      };
    } catch (err) {
      return {
        kind: 'create_task',
        status: 'failed',
        error: String(err?.message || err),
        attemptedAt,
      };
    }
  }

  async dismissRecommendation({ tenantId, recommendationId, actor, reason } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!recommendationId) throw new Error('recommendationId is required');

    const RecommendationModel = TenantRecommendation();
    const row = await RecommendationModel.findOne({
      where: { id: String(recommendationId), tenant_key: String(tenantId) },
    });
    if (!row) throw buildStatusError('recommendation_not_found', 404);

    const current = rowToJson(row);
    if (current.status !== 'open') throw buildStatusError('recommendation_not_open', 409);

    const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
    await row.update({
      status: 'dismissed',
      metadata: {
        ...metadata,
        dismissal: {
          dismissedAt: new Date().toISOString(),
          dismissedBy: actor || null,
          reason: reason ? String(reason) : null,
        },
      },
    });

    return { ok: true, recommendation: rowToJson(row) };
  }

  async evaluateOutcome({ tenantId, recommendationId } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!recommendationId) throw new Error('recommendationId is required');

    const RecommendationModel = TenantRecommendation();
    const row = await RecommendationModel.findOne({
      where: { id: String(recommendationId), tenant_key: String(tenantId) },
    });
    if (!row) throw buildStatusError('recommendation_not_found', 404);

    const current = rowToJson(row);
    if (current.status !== 'applied') throw buildStatusError('recommendation_not_applied', 409);

    const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
    const application = metadata.application || null;
    const baseline = Array.isArray(application?.baseline) ? application.baseline : [];
    const expectedDirection = application?.expectedDirection || 'observe';
    const evaluatedAt = new Date().toISOString();

    if (!application || baseline.length === 0) {
      const outcome = {
        evaluatedAt,
        outcome: 'pending',
        reason: 'no_baseline_metrics',
        metrics: [],
      };
      await row.update({
        status: 'completed',
        metadata: { ...metadata, outcome },
      });
      return { ok: true, recommendation: rowToJson(row), outcome };
    }

    const metrics = [];
    for (const entry of baseline) {
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await this._findLatestSnapshot({ tenantId, metricKey: entry.metricKey });
      const isNew = snapshot && snapshot.id !== entry.snapshotId
        && this._isSnapshotAfterCapture(snapshot, entry.capturedAt);

      if (!isNew) {
        metrics.push({
          metricKey: entry.metricKey,
          baselineValue: toNumber(entry.value, 0),
          currentValue: null,
          delta: null,
          deltaPct: null,
          assessment: 'pending',
          snapshotId: null,
        });
        continue;
      }

      const baselineValue = toNumber(entry.value, 0);
      const currentValue = toNumber(snapshot.value, 0);
      const delta = currentValue - baselineValue;
      const deltaPct = baselineValue !== 0 ? delta / Math.abs(baselineValue) : null;
      metrics.push({
        metricKey: entry.metricKey,
        baselineValue,
        currentValue,
        delta,
        deltaPct,
        assessment: this._assessDelta({ deltaPct, currentValue, expectedDirection }),
        snapshotId: snapshot.id,
      });
    }

    const outcome = {
      evaluatedAt,
      outcome: this._summarizeOutcome(metrics),
      metrics,
    };
    // Outcome pendente (sem snapshot novo) mantém a recomendação aplicada:
    // novos dados podem chegar e a medição será reavaliada.
    await row.update({
      status: outcome.outcome === 'pending' ? 'applied' : 'completed',
      metadata: { ...metadata, outcome },
    });

    // Learn: outcome medido vira evidencia no EvidenceEngine do insight de
    // origem, fechando o loop Recommendation -> Action -> Outcome -> Learn.
    // Falha de evidencia nao derruba a avaliacao; fica explicita na resposta.
    let evidenceRecorded = false;
    if (outcome.outcome !== 'pending' && current.insight_id) {
      evidenceRecorded = await this._recordOutcomeEvidence({
        tenantId,
        insightId: current.insight_id,
        recommendationId,
        outcome,
      });
    }

    return { ok: true, recommendation: rowToJson(row), outcome, evidenceRecorded };
  }

  async _recordOutcomeEvidence({ tenantId, insightId, recommendationId, outcome }) {
    try {
      await this.evidenceEngine.createEvidence({
        tenantId: String(tenantId),
        insightId: String(insightId),
        evidenceType: 'outcome_evaluation',
        sourceType: 'tenant_recommendation',
        sourceId: String(recommendationId),
        excerpt: `Resultado medido da recomendacao: ${outcome.outcome}.`,
        structuredData: outcome,
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Fechamento event-driven do loop Decision Intelligence: chamado quando
   * novos snapshots sao coletados, avalia automaticamente as recomendacoes
   * aplicadas cuja metrica de baseline ganhou snapshot posterior ao apply.
   * Sem snapshot novo a recomendacao permanece 'applied' (aguardando dados).
   */
  async evaluatePendingOutcomes({ tenantId } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const RecommendationModel = TenantRecommendation();
    const rows = await RecommendationModel.findAll({
      where: { tenant_key: String(tenantId), status: 'applied' },
    });

    const results = [];
    let evaluated = 0;
    let pending = 0;

    for (const row of rows || []) {
      const reco = row.toJSON ? row.toJSON() : row;
      const baseline = Array.isArray(reco.metadata?.application?.baseline)
        ? reco.metadata.application.baseline
        : [];

      let hasNewSnapshot = false;
      for (const entry of baseline) {
        // eslint-disable-next-line no-await-in-loop
        const snapshot = await this._findLatestSnapshot({ tenantId, metricKey: entry.metricKey });
        if (snapshot && snapshot.id !== entry.snapshotId
          && this._isSnapshotAfterCapture(snapshot, entry.capturedAt)) {
          hasNewSnapshot = true;
          break;
        }
      }

      if (!hasNewSnapshot) {
        pending += 1;
        results.push({ recommendationId: reco.id, outcome: 'pending' });
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const evaluation = await this.evaluateOutcome({ tenantId, recommendationId: reco.id });
      const outcomeKind = evaluation.outcome?.outcome || 'pending';
      if (outcomeKind === 'pending') pending += 1; else evaluated += 1;
      results.push({ recommendationId: reco.id, outcome: outcomeKind });
    }

    return {
      ok: true,
      total: (rows || []).length,
      evaluated,
      pending,
      results,
    };
  }

  _assessDelta({ deltaPct, currentValue, expectedDirection }) {
    if (deltaPct == null) {
      // Baseline zerada: qualquer valor positivo eh movimento relevante.
      if (currentValue > 0) {
        if (expectedDirection === 'up') return 'improved';
        if (expectedDirection === 'down') return 'regressed';
        return 'changed';
      }
      return expectedDirection === 'observe' ? 'stable' : 'unchanged';
    }

    if (expectedDirection === 'observe') {
      return Math.abs(deltaPct) >= 0.05 ? 'changed' : 'stable';
    }
    if (expectedDirection === 'down') {
      if (deltaPct <= -0.05) return 'improved';
      if (deltaPct >= 0.05) return 'regressed';
      return 'unchanged';
    }
    if (deltaPct >= 0.05) return 'improved';
    if (deltaPct <= -0.05) return 'regressed';
    return 'unchanged';
  }

  _summarizeOutcome(metrics) {
    const assessments = (metrics || []).map((item) => item.assessment);
    if (assessments.length === 0 || assessments.every((item) => item === 'pending')) return 'pending';
    if (assessments.includes('regressed')) return 'regressed';
    if (assessments.includes('improved')) return 'improved';
    return 'unchanged';
  }

  _isSnapshotAfterCapture(snapshot, capturedAt) {
    const snapTime = snapshot?.created_at || snapshot?.createdAt || snapshot?.period_end || snapshot?.periodEnd || null;
    if (!snapTime || !capturedAt) return true;
    const snapMs = new Date(snapTime).getTime();
    const capturedMs = new Date(capturedAt).getTime();
    if (!Number.isFinite(snapMs) || !Number.isFinite(capturedMs)) return true;
    return snapMs > capturedMs;
  }

  async _resolveBaselineMetricKeys(recommendation) {
    if (recommendation?.insight_id) {
      const InsightModel = TenantInsight();
      const insight = await InsightModel.findOne({
        where: { id: String(recommendation.insight_id), tenant_key: String(recommendation.tenant_key) },
      });
      const insightJson = rowToJson(insight);
      if (Array.isArray(insightJson?.related_metrics) && insightJson.related_metrics.length > 0) {
        return insightJson.related_metrics.map((key) => String(key));
      }
    }
    const related = recommendation?.metadata?.relatedMetrics;
    if (Array.isArray(related) && related.length > 0) {
      return related.map((key) => String(key));
    }
    return [];
  }

  async _findLatestSnapshot({ tenantId, metricKey } = {}) {
    const SnapshotModel = TenantMetricSnapshot();
    const row = await SnapshotModel.findOne({
      where: { tenant_key: String(tenantId), metric_key: String(metricKey) },
      order: [['period_end', 'DESC'], ['created_at', 'DESC']],
    });
    return rowToJson(row);
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
        // Action real (contrato NBA-style): aplicar a recomendacao executa
        // a acao mapeada. Todas as recomendacoes derivadas de insights sao
        // de investigacao/revisao -> viram tarefa operacional no Workspace.
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
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
        // Action real (contrato NBA-style): aplicar a recomendacao executa
        // a acao mapeada. Todas as recomendacoes derivadas de insights sao
        // de investigacao/revisao -> viram tarefa operacional no Workspace.
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
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
        // Action real (contrato NBA-style): aplicar a recomendacao executa
        // a acao mapeada. Todas as recomendacoes derivadas de insights sao
        // de investigacao/revisao -> viram tarefa operacional no Workspace.
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
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
        // Action real (contrato NBA-style): aplicar a recomendacao executa
        // a acao mapeada. Todas as recomendacoes derivadas de insights sao
        // de investigacao/revisao -> viram tarefa operacional no Workspace.
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
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
        // Action real (contrato NBA-style): aplicar a recomendacao executa
        // a acao mapeada. Todas as recomendacoes derivadas de insights sao
        // de investigacao/revisao -> viram tarefa operacional no Workspace.
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
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
      // Action real: revisao humana vira tarefa operacional no Workspace.
      action: { kind: 'create_task', label: 'Criar tarefa de revisao' },
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

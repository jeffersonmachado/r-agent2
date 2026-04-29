'use strict';

const { WorkspaceAction } = require('../../db/models');
const logger = require('../../utils/logger');
const WorkspaceInsightService = require('./WorkspaceInsightService');
const WorkspaceOperationsService = require('./WorkspaceOperationsService');
const { safeString, toPlain } = require('./workspaceUtils');

class WorkspaceActionService {
  constructor(deps = {}) {
    this.WorkspaceAction = deps.WorkspaceAction || WorkspaceAction;
    this.insightService = deps.insightService || new WorkspaceInsightService(deps);
    this.operationsService = deps.operationsService || new WorkspaceOperationsService(deps);
    this.logger = deps.logger || logger;
  }

  async listActions({ tenantId, entityId, limit = 50 }) {
    const rows = await this.WorkspaceAction().findAll({ where: { tenant_id: tenantId, entity_id: entityId }, order: [['created_at', 'DESC']], limit });
    return rows.map(toPlain);
  }

  async createAction({ tenantId, entityId, type = 'task', status = 'pending', payload = {} }) {
    return toPlain(await this.WorkspaceAction().create({ tenant_id: tenantId, entity_id: entityId, type, status, payload: payload && typeof payload === 'object' ? payload : {} }));
  }

  async createActionFromEvent({ tenantId, entityId, event }) {
    const type = event?.type === 'evidence' ? 'automation' : 'followup';
    return this.createAction({ tenantId, entityId, type, payload: { title: event?.type === 'evidence' ? 'Revisar evidencia QA/RPA' : 'Realizar follow-up', sourceEvent: event } });
  }

  async autoCreateTasksFromInsights({ tenantId, entityId, insights = [] }) {
    const created = [];
    for (const insight of insights) {
      const insightType = safeString(insight.type);
      const source = safeString(insight.source).toLowerCase();
      const critical = insight.severity === 'critical' || source === 'rpa';
      if (!['risk', 'delay', 'churn'].includes(insightType) && !critical) continue;
      const title = critical
        ? 'Acionar correcao tecnica QA/RPA'
        : insightType === 'delay'
          ? 'Responder cliente com SLA em risco'
          : insightType === 'churn'
            ? 'Fazer follow-up de reativacao'
            : 'Mitigar risco operacional do cliente';
      const task = await this.operationsService.createTask({ tenantId, payload: { entityId, title, description: insight.description, type: critical ? 'rpa' : 'ai', priority: critical || insightType === 'risk' ? 'high' : 'normal' } });
      created.push(await this.createAction({ tenantId, entityId, type: 'task', status: 'executed', payload: { title, task, sourceInsight: insight } }));
    }
    return created;
  }

  async suggestNextBestAction({ tenantId, entityId }) {
    const insightResult = await this.insightService.generateInsights(entityId, { tenantId });
    const insights = insightResult?.items || [];
    const top = insights.find((item) => item.severity === 'critical') || insights[0];
    if (!top) return { type: 'followup', label: 'Registrar proximo contato', reason: 'Nao ha riscos criticos detectados; manter cadencia de relacionamento.', confidence: 0.55 };
    const map = {
      delay: ['task', 'Criar tarefa de resposta SLA', 'Existe atraso ou risco de SLA na timeline.'],
      risk: ['task', top.source === 'RPA' ? 'Criar tarefa tecnica QA/RPA' : 'Criar tarefa de mitigacao', 'Ha risco operacional associado ao cliente.'],
      churn: ['followup', 'Criar follow-up de reativacao', 'Cliente esta inativo ha tempo relevante.'],
      opportunity: ['followup', 'Fazer abordagem comercial consultiva', 'Ha sinais de oportunidade comercial.'],
      upsell: ['followup', 'Sugerir proxima oferta', 'Cliente ativo pode aceitar expansao.'],
    };
    const [type, label, reason] = map[top.type] || map.opportunity;
    return { type, label, reason, confidence: top.confidence || 0.65, sourceInsight: top };
  }
}

module.exports = WorkspaceActionService;

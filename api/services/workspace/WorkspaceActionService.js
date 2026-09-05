'use strict';

const { WorkspaceAction, WorkspaceEntityLink } = require('../../db/models');
const logger = require('../../utils/logger');
const WorkspaceInsightService = require('./WorkspaceInsightService');
const WorkspaceOperationsService = require('./WorkspaceOperationsService');
const { safeString, toPlain } = require('./workspaceUtils');

const { isTechnicalInsight } = WorkspaceInsightService;

class WorkspaceActionService {
  constructor(deps = {}) {
    this.WorkspaceAction = deps.WorkspaceAction || WorkspaceAction;
    this.WorkspaceEntityLink = deps.WorkspaceEntityLink || WorkspaceEntityLink;
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

  async latestConversationId({ tenantId, entityId }) {
    try {
      const link = await this.WorkspaceEntityLink().findOne({
        where: { tenant_id: tenantId, entity_id: entityId, source_type: 'conversation' },
        order: [['created_at', 'DESC']],
      });
      return toPlain(link)?.source_id || null;
    } catch (err) {
      this.logger.warn('[WorkspaceAction] Falha ao buscar conversa vinculada', { tenantId, entityId, error: err.message });
      return null;
    }
  }

  async suggestNextBestAction({ tenantId, entityId, classification } = {}) {
    const insightResult = await this.insightService.generateInsights(entityId, { tenantId, includeTechnical: classification === 'DEVELOPMENT' });
    const insights = insightResult?.items || [];
    const top = insights.find((item) => item.severity === 'critical') || insights[0];
    if (!top) {
      return {
        type: 'followup',
        label: 'Registrar proximo contato',
        reason: 'Nao ha riscos criticos detectados; manter cadencia de relacionamento.',
        confidence: 0.55,
        expectedOutcome: 'Manter o relacionamento ativo e prevenir riscos',
        risk: 'low',
        action: { kind: 'schedule', conversationId: null, label: 'Agendar proximo contato' },
      };
    }

    const technical = isTechnicalInsight(top);
    const map = {
      delay: {
        type: 'task',
        label: 'Criar tarefa de resposta SLA',
        reason: 'Existe atraso ou risco de SLA na timeline.',
        expectedOutcome: 'Restabelecer o SLA e evitar escalacao',
        risk: 'medium',
        action: { kind: 'create_task', conversationId: null, label: 'Criar tarefa de resposta' },
      },
      risk: technical
        ? {
          type: 'task',
          label: 'Criar tarefa tecnica QA/RPA',
          reason: 'Ha risco operacional associado ao cliente.',
          expectedOutcome: 'Resolver a falha tecnica antes que afete o cliente',
          risk: 'high',
          action: { kind: 'create_task', conversationId: null, label: 'Criar tarefa tecnica' },
        }
        : {
          type: 'followup',
          label: 'Falar com o cliente sobre a situacao',
          reason: 'Ha risco operacional associado ao cliente.',
          expectedOutcome: 'Reduzir o risco operacional e preservar o relacionamento',
          risk: 'medium',
          action: { kind: 'send_message', label: 'Enviar mensagem ao cliente' },
        },
      churn: {
        type: 'followup',
        label: 'Criar follow-up de reativacao',
        reason: 'Cliente esta inativo ha tempo relevante.',
        expectedOutcome: 'Recuperar o relacionamento e evitar churn',
        risk: 'low',
        action: { kind: 'send_message', label: 'Enviar mensagem de reativacao' },
      },
      opportunity: {
        type: 'followup',
        label: 'Fazer abordagem comercial consultiva',
        reason: 'Ha sinais de oportunidade comercial.',
        expectedOutcome: 'Converter a oportunidade identificada em receita',
        risk: 'low',
        action: { kind: 'send_message', label: 'Iniciar abordagem comercial' },
      },
      upsell: {
        type: 'followup',
        label: 'Sugerir proxima oferta',
        reason: 'Cliente ativo pode aceitar expansao.',
        expectedOutcome: 'Expandir o relacionamento com uma nova oferta',
        risk: 'low',
        action: { kind: 'send_message', label: 'Enviar proposta de expansao' },
      },
    };
    const suggestion = map[top.type] || map.opportunity;
    const action = { ...suggestion.action };
    if (action.kind === 'send_message') {
      action.conversationId = await this.latestConversationId({ tenantId, entityId });
    } else if (action.conversationId === undefined) {
      action.conversationId = null;
    }
    return {
      type: suggestion.type,
      label: suggestion.label,
      reason: suggestion.reason,
      confidence: top.confidence || 0.65,
      sourceInsight: top,
      expectedOutcome: suggestion.expectedOutcome,
      risk: suggestion.risk,
      action,
    };
  }
}

module.exports = WorkspaceActionService;

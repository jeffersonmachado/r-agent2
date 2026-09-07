'use strict';

const { TenantRecommendation, TenantInsight, TenantMetricSnapshot, ChannelMessage, ChannelConversation, Task } = require('../../db/models');
const { Op } = require('sequelize');
const { buildId, toNumber } = require('./helpers');

// Direcao esperada do movimento da metrica por tipo de insight de origem.
const OUTCOME_DIRECTION_BY_INSIGHT = {
  metric_drop: 'up',
  goal_off_track: 'up',
  goal_at_risk: 'up',
  metric_increase: 'observe',
  event_concentration: 'down',
};

// Ações customer-facing: atingem o cliente (mensagem no canal) ou compromisso
// operacional agendado. NUNCA executam em origem automática (auto-apply do
// nível autonomous/exception_only) — exigem apply humano explícito (manual ou
// batch com actor). Ações internas (create_task) seguem o auto-apply normal.
const CUSTOMER_FACING_ACTION_KINDS = new Set(['send_message', 'schedule']);

// Janela de espera por resposta do cliente após send_message executado:
// antes dela, o sinal é 'awaiting_reply' (outcome permanece pendente);
// depois dela sem resposta, vira 'no_reply' (outcome unchanged).
const REPLY_WINDOW_MS = 24 * 3600000;

// Métrica operacional de primeira resposta (fonte: MetricEngine). Quando ela
// aparece como causa provável em alta (direction 'up') de uma queda de
// métrica/meta em risco, a recomendação ganha ação operacional executável
// (redistribuir conversas abertas) em vez de apenas "criar tarefa de
// investigação" — Métrica → Causa → Recomendação → Ação → Outcome.
const FIRST_RESPONSE_METRIC = 'operations.avg_first_response_minutes';

function firstResponseCause(insight) {
  const causes = insight && insight.metadata && Array.isArray(insight.metadata.probableCauses)
    ? insight.metadata.probableCauses
    : [];
  return causes.find((cause) => cause
    && cause.metricKey === FIRST_RESPONSE_METRIC
    && cause.direction === 'up') || null;
}

// Papéis elegíveis para receber conversas redistribuídas (mesma regra do
// assignmentService.isEligibleAgent, duplicada aqui para não acoplar ao
// pipeline legado de tickets).
const ELIGIBLE_ASSIGNEE_ROLES = new Set(['operator', 'manager', 'admin', 'owner']);

// Teto de segurança: um único apply nunca move mais que este número de
// conversas, mesmo em tenants com fila gigante.
const REBALANCE_MAX_MOVES = 100;

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
    this._capabilitiesService = deps.capabilitiesService || null;
    this._channelConversationService = deps.channelConversationService || null;
    this._outboundQueueService = deps.outboundQueueService || null;
    this._authService = deps.authService || null;
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

  get capabilitiesService() {
    if (!this._capabilitiesService) {
      // eslint-disable-next-line global-require
      this._capabilitiesService = require('../../services/tenantCapabilitiesService');
    }
    return this._capabilitiesService;
  }

  get channelConversationService() {
    if (!this._channelConversationService) {
      // eslint-disable-next-line global-require
      this._channelConversationService = require('../../services/channelConversationService');
    }
    return this._channelConversationService;
  }

  get outboundQueueService() {
    if (!this._outboundQueueService) {
      // eslint-disable-next-line global-require
      this._outboundQueueService = require('../../services/outboundQueueService');
    }
    return this._outboundQueueService;
  }

  get authService() {
    if (!this._authService) {
      // eslint-disable-next-line global-require
      this._authService = require('../../services/authService');
    }
    return this._authService;
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

  /**
   * Product Metrics da camada de decisão — agregações reais sobre
   * tenant_recommendations (status, application.origin, outcome).
   * Responde: a IA é aceita? As ações dão resultado? Quanto é automático?
   *
   * @param {string} tenantId
   * @param {string} period - day|week|month|quarter|all (default month = 30d)
   */
  async getRecommendationStats({ tenantId, period = 'month' } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const PERIOD_DAYS = { day: 1, week: 7, month: 30, quarter: 90 };
    const periodKey = PERIOD_DAYS[period] ? String(period) : (String(period) === 'all' ? 'all' : 'month');
    const days = PERIOD_DAYS[periodKey] || null;
    const cutoff = days != null ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    const RecommendationModel = TenantRecommendation();
    const rows = await RecommendationModel.findAll({
      where: { tenant_key: String(tenantId) },
      order: [['created_at', 'DESC']],
      limit: 5000,
    });

    const items = (rows || [])
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .filter((item) => {
        if (!cutoff) return true;
        const createdAt = item.created_at || item.createdAt || null;
        const ms = createdAt ? new Date(createdAt).getTime() : NaN;
        // Sem timestamp confiável não entra na janela (fail-closed por período).
        return Number.isFinite(ms) && ms >= cutoff.getTime();
      });

    const byStatus = { open: 0, applied: 0, dismissed: 0, completed: 0 };
    let originManual = 0;
    let originAuto = 0;
    let originBatch = 0;
    let outcomeImproved = 0;
    let outcomeRegressed = 0;
    let outcomeUnchanged = 0;

    for (const item of items) {
      const status = String(item.status || 'open');
      if (byStatus[status] != null) byStatus[status] += 1;

      const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
      const origin = metadata.application?.origin || null;
      if (origin === 'auto') originAuto += 1;
      else if (origin === 'batch') originBatch += 1;
      else if (origin === 'manual') originManual += 1;

      const outcome = metadata.outcome?.outcome || null;
      if (outcome === 'improved') outcomeImproved += 1;
      else if (outcome === 'regressed') outcomeRegressed += 1;
      else if (outcome === 'unchanged') outcomeUnchanged += 1;
    }

    const accepted = byStatus.applied + byStatus.completed;
    const decided = accepted + byStatus.dismissed;
    const appliedTotal = accepted;
    const automatedApplied = originAuto + originBatch;
    const outcomeEvaluated = outcomeImproved + outcomeRegressed + outcomeUnchanged;
    // Aplicadas sem outcome medido ainda aguardam dados (evaluatePendingOutcomes).
    const pendingEvaluation = Math.max(0, appliedTotal - outcomeEvaluated);

    return {
      ok: true,
      stats: {
        period: periodKey,
        total: items.length,
        byStatus,
        acceptance: {
          decided,
          accepted,
          dismissed: byStatus.dismissed,
          rate: decided > 0 ? accepted / decided : null,
        },
        outcome: {
          evaluated: outcomeEvaluated,
          improved: outcomeImproved,
          regressed: outcomeRegressed,
          unchanged: outcomeUnchanged,
          pendingEvaluation,
          successRate: outcomeEvaluated > 0 ? outcomeImproved / outcomeEvaluated : null,
        },
        automation: {
          applied: appliedTotal,
          manual: originManual,
          auto: originAuto,
          batch: originBatch,
          automationRate: appliedTotal > 0 ? automatedApplied / appliedTotal : null,
          humanInterventionRate: appliedTotal > 0 ? originManual / appliedTotal : null,
        },
      },
    };
  }

  async generateRecommendations({ tenantId, insights = [], goals = [] } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const created = [];
    let skipped = 0;

    for (const insight of insights || []) {
      const mapped = this._mapInsightToRecommendation(insight, goals);
      if (!mapped) continue;

      // Explanation/Prediction fluem para a recomendacao (e para a descricao
      // da tarefa criada no apply), mantendo o usuario no idioma de resultado.
      this._enrichMappedRecommendation(mapped, insight);

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

    // Autonomy UX: nível de autonomia do tenant decide se as recomendações
    // recém-criadas são aplicadas automaticamente (autonomous/exception_only)
    // ou aguardam decisão humana (suggest/approve). Fail-soft explícito:
    // indisponibilidade de capabilities fica declarada no resultado.
    const autoApply = await this._maybeAutoApply({ tenantId, created });

    return {
      ok: true,
      created: created.length,
      skipped,
      recommendations: created,
      autoApply,
    };
  }

  /**
   * Auto-apply governado pelo autonomyLevel do tenant:
   *   suggest/approve → nenhuma aplicação automática;
   *   autonomous      → aplica todas as recém-criadas (actor 'system');
   *   exception_only  → aplica todas, exceto priority 'high' (exceções humanas).
   * Falhas individuais são contadas, sem derrubar a geração.
   */
  async _maybeAutoApply({ tenantId, created = [] } = {}) {
    if (!Array.isArray(created) || created.length === 0) {
      return { attempted: false, reason: 'no_recommendations_created' };
    }

    let autonomyLevel = 'suggest';
    try {
      const capabilities = await this.capabilitiesService.getTenantCapabilities(tenantId);
      autonomyLevel = capabilities?.autonomyLevel || 'suggest';
    } catch (err) {
      return { attempted: false, reason: 'capabilities_unavailable' };
    }

    if (autonomyLevel !== 'autonomous' && autonomyLevel !== 'exception_only') {
      return { attempted: false, reason: 'manual_autonomy', autonomyLevel };
    }

    let applied = 0;
    let failed = 0;
    let skippedHighPriority = 0;
    let skippedCustomerFacing = 0;

    for (const item of created) {
      if (autonomyLevel === 'exception_only' && item?.priority === 'high') {
        skippedHighPriority += 1;
        continue;
      }
      // Ações customer-facing nunca executam em origem automática — ficam
      // abertas para apply humano ("Aprovar" no Workspace).
      if (CUSTOMER_FACING_ACTION_KINDS.has(item?.metadata?.action?.kind)) {
        skippedCustomerFacing += 1;
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.applyRecommendation({
          tenantId,
          recommendationId: item.id,
          actor: 'system',
          origin: 'auto',
        });
        if (result?.ok) applied += 1; else failed += 1;
      } catch (err) {
        failed += 1;
      }
    }

    return {
      attempted: true,
      autonomyLevel,
      applied,
      failed,
      ...(skippedHighPriority > 0 ? { skippedHighPriority } : {}),
      ...(skippedCustomerFacing > 0 ? { skippedCustomerFacing } : {}),
    };
  }

  /**
   * Aplica em lote as recomendações abertas do tenant ("Aprovar todas" do
   * nível approve). Falha individual não interrompe o lote; cada item
   * falho fica explícito em results.
   */
  async applyAllOpen({ tenantId, actor, limit = 50 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const { items } = await this.listRecommendations({ tenantId, status: 'open', limit });

    let applied = 0;
    let failed = 0;
    const results = [];

    for (const item of items || []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.applyRecommendation({
          tenantId,
          recommendationId: item.id,
          actor,
          origin: 'batch',
        });
        if (result?.ok) {
          applied += 1;
          results.push({ recommendationId: item.id, ok: true });
        } else {
          failed += 1;
          results.push({ recommendationId: item.id, ok: false, error: 'apply_not_ok' });
        }
      } catch (err) {
        failed += 1;
        results.push({ recommendationId: item.id, ok: false, error: String(err?.code || err?.message || err) });
      }
    }

    return { ok: true, applied, failed, results };
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

  async applyRecommendation({ tenantId, recommendationId, actor, origin } = {}) {
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

    // Action real: aplicar uma recomendação executa a ação mapeada
    // (create_task, send_message, schedule). Falha de execução é explícita
    // na resposta e no metadata, sem reverter a decisão de aplicação.
    // Governança de autonomia: ações customer-facing (send_message, schedule)
    // nunca executam em origem automática — exigem apply humano/manual.
    let execution = null;
    const action = metadata.action && typeof metadata.action === 'object' ? metadata.action : null;
    if (action?.kind) {
      if (CUSTOMER_FACING_ACTION_KINDS.has(action.kind) && origin === 'auto') {
        throw buildStatusError('customer_facing_action_requires_human_apply', 409);
      }
      execution = await this._executeAction({ tenantId, recommendation: current, action });
    }

    await row.update({
      status: 'applied',
      metadata: {
        ...metadata,
        application: {
          appliedAt: capturedAt,
          appliedBy: actor || null,
          origin: origin ? String(origin) : 'manual',
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

  async _executeAction({ tenantId, recommendation, action }) {
    switch (action.kind) {
      case 'create_task':
        return this._executeCreateTask({ tenantId, recommendation, action });
      case 'send_message':
        return this._executeSendMessage({ tenantId, recommendation, action });
      case 'schedule':
        return this._executeSchedule({ tenantId, recommendation, action });
      case 'rebalance_queue':
        return this._executeRebalanceQueue({ tenantId, recommendation, action });
      default:
        return {
          kind: String(action.kind),
          status: 'skipped',
          reason: 'unsupported_action_kind',
          attemptedAt: new Date().toISOString(),
        };
    }
  }

  /**
   * Ação operacional "redistribuir conversas abertas": atribui conversas sem
   * dono e move conversas do atendente mais carregado para o menos carregado
   * até equilibrar (diferença < 2). Opera sobre ChannelConversation real
   * (DB), com pool de atendentes elegíveis do tenant. Ação interna (não
   * customer-facing): pode auto-aplicar no nível autonomous — o tenant
   * delegou execução operacional. O outcome é medido pelas métricas de
   * baseline (tempo de primeira resposta) no loop evaluatePendingOutcomes.
   */
  async _executeRebalanceQueue({ tenantId, recommendation, action }) {
    const attemptedAt = new Date().toISOString();
    const base = { kind: 'rebalance_queue', label: action.label || null };
    try {
      const result = await this.channelConversationService.listConversations({
        tenantId: String(tenantId),
        status: 'open',
        limit: 500,
      });
      const conversations = Array.isArray(result?.items) ? result.items : [];
      if (conversations.length < 2) {
        return { ...base, status: 'skipped', reason: 'not_enough_open_conversations', attemptedAt };
      }

      const agents = await this.authService.listAgents(String(tenantId));
      const eligible = (agents || []).filter((agent) => agent
        && agent.active !== false
        && (!agent.status || agent.status === 'active')
        && ELIGIBLE_ASSIGNEE_ROLES.has(agent.role));
      if (eligible.length === 0) {
        return { ...base, status: 'skipped', reason: 'no_eligible_agents', attemptedAt };
      }
      const eligibleIds = new Set(eligible.map((agent) => String(agent.id)));

      // Carga atual: apenas conversas abertas atribuídas a atendentes
      // elegíveis entram no balanceamento; sem dono entram na fila de atribuir.
      const load = new Map(eligible.map((agent) => [String(agent.id), 0]));
      const byAssignee = new Map();
      const unassigned = [];
      for (const conversation of conversations) {
        const assignee = conversation.assignedTo || conversation.assigned_to || null;
        if (assignee && eligibleIds.has(String(assignee))) {
          const key = String(assignee);
          load.set(key, (load.get(key) || 0) + 1);
          if (!byAssignee.has(key)) byAssignee.set(key, []);
          byAssignee.get(key).push(conversation);
        } else if (!assignee) {
          unassigned.push(conversation);
        }
      }

      const leastLoaded = () => {
        let best = null;
        let bestCount = Infinity;
        for (const [id, count] of load.entries()) {
          if (count < bestCount) { bestCount = count; best = id; }
        }
        return best;
      };

      const moves = [];
      // 1) Conversas sem dono → atendente menos carregado.
      for (const conversation of unassigned) {
        if (moves.length >= REBALANCE_MAX_MOVES) break;
        const target = leastLoaded();
        if (!target) break;
        moves.push({ conversationId: conversation.id, to: target });
        load.set(target, load.get(target) + 1);
      }
      // 2) Rebalanceamento: do mais carregado para o menos carregado.
      for (;;) {
        if (moves.length >= REBALANCE_MAX_MOVES) break;
        let maxId = null;
        let maxCount = -1;
        for (const [id, count] of load.entries()) {
          if (count > maxCount && (byAssignee.get(id) || []).length > 0) {
            maxCount = count;
            maxId = id;
          }
        }
        const minId = leastLoaded();
        const minCount = minId != null ? load.get(minId) : 0;
        if (maxId == null || minId == null || maxId === minId || maxCount - minCount < 2) break;
        const conversation = byAssignee.get(maxId).pop();
        moves.push({ conversationId: conversation.id, from: maxId, to: minId });
        load.set(maxId, load.get(maxId) - 1);
        load.set(minId, load.get(minId) + 1);
      }

      if (moves.length === 0) {
        return { ...base, status: 'skipped', reason: 'already_balanced', attemptedAt };
      }

      let assigned = 0;
      let rebalanced = 0;
      let failedMoves = 0;
      for (const move of moves) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.channelConversationService.updateConversation({
            tenantId: String(tenantId),
            conversationId: String(move.conversationId),
            patch: { assigned_to: move.to },
          });
          if (move.from) rebalanced += 1; else assigned += 1;
        } catch (err) {
          failedMoves += 1;
        }
      }

      if (failedMoves === moves.length) {
        return { ...base, status: 'failed', error: 'all_moves_failed', attemptedAt };
      }

      return {
        ...base,
        status: 'executed',
        assigned,
        rebalanced,
        failedMoves,
        agents: eligible.length,
        distribution: Object.fromEntries(load),
        // Conversas movidas: base do sinal comportamental de outcome
        // (a equipe respondeu nelas após a redistribuição?).
        conversationIds: moves.map((move) => String(move.conversationId)),
        recommendationId: recommendation.id,
        attemptedAt,
        executedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { ...base, status: 'failed', error: String(err?.message || err), attemptedAt };
    }
  }

  async _executeSendMessage({ tenantId, recommendation, action }) {
    const attemptedAt = new Date().toISOString();
    const base = { kind: 'send_message', label: action.label || null };
    try {
      const conversationId = action.conversationId ? String(action.conversationId) : null;
      if (!conversationId) {
        return { ...base, status: 'skipped', reason: 'missing_conversation_id', attemptedAt };
      }
      const text = action.message || action.text || null;
      if (!text || !String(text).trim()) {
        return { ...base, status: 'skipped', reason: 'missing_message_text', attemptedAt };
      }
      const conversation = await this.channelConversationService.getConversation({
        tenantId: String(tenantId),
        conversationId,
      });
      if (!conversation) {
        return { ...base, status: 'skipped', reason: 'conversation_not_found', attemptedAt };
      }

      const clientMessageId = `reco-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const message = await this.channelConversationService.createMessage({
        tenantId: String(tenantId),
        conversationId: conversation.id,
        channelType: conversation.channelType,
        direction: 'out',
        type: 'text',
        body: { text: String(text) },
        externalMessageId: clientMessageId,
        status: 'pending',
      });
      await this.outboundQueueService.enqueueOutbound({
        tenantId: String(tenantId),
        channelType: conversation.channelType,
        conversationId: conversation.id,
        message: {
          to: conversation.externalId,
          type: 'text',
          body: { text: String(text) },
          meta: {
            conversationId: conversation.id,
            clientMessageId,
            recommendationId: recommendation.id,
          },
        },
      });
      return {
        ...base,
        status: 'executed',
        messageId: message?.id || null,
        conversationId: conversation.id,
        externalMessageId: clientMessageId,
        executedAt: attemptedAt,
      };
    } catch (err) {
      return { ...base, status: 'failed', error: String(err?.message || err), attemptedAt };
    }
  }

  async _executeSchedule({ tenantId, recommendation, action }) {
    const attemptedAt = new Date().toISOString();
    try {
      const dueDate = action.dueDate || new Date(Date.now() + 86400000).toISOString();
      const task = await this.workspaceOperations.createTask({
        tenantId: String(tenantId),
        payload: {
          title: `[Recomendação] ${String(recommendation.title || '').slice(0, 180)}`,
          description: `${recommendation.description || ''}\n\nOrigem: recomendação ${recommendation.id}${recommendation.insight_id ? ` (insight ${recommendation.insight_id})` : ''}`,
          type: 'followup',
          priority: recommendation.priority === 'high' ? 'high' : (recommendation.priority === 'low' ? 'low' : 'normal'),
          dueDate,
          conversationId: action.conversationId ? String(action.conversationId) : null,
        },
      });
      return {
        kind: 'schedule',
        status: 'executed',
        taskId: task?.id || null,
        dueDate,
        label: action.label || null,
        executedAt: attemptedAt,
      };
    } catch (err) {
      return {
        kind: 'schedule',
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
      // Sem métricas de baseline, o outcome pode vir do sinal comportamental
      // da ação executada (ex.: cliente respondeu após send_message, tarefa
      // concluída após create_task/schedule). Sinal "aguardando" mantém a
      // recomendação aplicada para reavaliação event-driven.
      const actionSignals = application
        ? await this._collectActionSignals({ tenantId, application })
        : [];
      const derived = this._deriveOutcomeFromSignals(actionSignals);
      const outcome = {
        evaluatedAt,
        outcome: derived?.outcome || 'pending',
        reason: derived?.reason || 'no_baseline_metrics',
        metrics: [],
        ...(actionSignals.length > 0 ? { actionSignals } : {}),
      };
      await row.update({
        status: derived?.awaitingSignal ? 'applied' : 'completed',
        metadata: { ...metadata, outcome },
      });
      let signalEvidence = false;
      if (outcome.outcome !== 'pending' && current.insight_id) {
        signalEvidence = await this._recordOutcomeEvidence({
          tenantId,
          insightId: current.insight_id,
          recommendationId,
          outcome,
        });
      }
      // Learn de 2º nível: rebalance sem resposta da equipe gera recomendação
      // seguinte (escalonamento/reforço), fechando o loop sobre o próprio loop.
      const followUp = await this._maybeCreateRebalanceFollowUp({ tenantId, row, outcome });
      return {
        ok: true,
        recommendation: rowToJson(row),
        outcome,
        evidenceRecorded: signalEvidence,
        ...(followUp ? { followUp } : {}),
      };
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

    const actionSignals = await this._collectActionSignals({ tenantId, application });
    const summarized = this._summarizeOutcome(metrics);
    // Métricas dominam quando há snapshot novo. Se ainda estão pendentes e o
    // sinal comportamental já é positivo (cliente respondeu / tarefa concluída),
    // o sinal fecha o outcome — a evidência real da ação não espera agregado.
    const derived = this._deriveOutcomeFromSignals(actionSignals);
    const signalCloses = summarized === 'pending' && derived?.outcome === 'improved';
    const outcome = {
      evaluatedAt,
      outcome: signalCloses ? 'improved' : summarized,
      ...(signalCloses ? { reason: derived.reason } : {}),
      metrics,
      ...(actionSignals.length > 0 ? { actionSignals } : {}),
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

    const followUp = await this._maybeCreateRebalanceFollowUp({ tenantId, row, outcome });
    return {
      ok: true,
      recommendation: rowToJson(row),
      outcome,
      evidenceRecorded,
      ...(followUp ? { followUp } : {}),
    };
  }

  /**
   * Sinais comportamentais da ação executada — outcome medido no efeito real
   * da ação, não só em métricas agregadas:
   * - send_message: o cliente respondeu na conversa após o envio?
   * - create_task/schedule: a tarefa criada foi concluída?
   * Falha de leitura de sinal é explícita (signal com outcome 'unavailable'),
   * nunca derruba a avaliação.
   */
  async _collectActionSignals({ tenantId, application }) {
    const executed = application?.executedAction;
    if (!executed || executed.status !== 'executed') return [];

    const signals = [];
    if (executed.kind === 'send_message' && executed.conversationId) {
      // eslint-disable-next-line no-await-in-loop
      signals.push(await this._signalCustomerReply({ tenantId, executed }));
    }
    if ((executed.kind === 'create_task' || executed.kind === 'schedule') && executed.taskId) {
      // eslint-disable-next-line no-await-in-loop
      signals.push(await this._signalTaskCompletion({ tenantId, executed }));
    }
    if (executed.kind === 'rebalance_queue' && Array.isArray(executed.conversationIds) && executed.conversationIds.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      signals.push(await this._signalRebalanceResponse({ tenantId, executed }));
    }
    return signals.filter(Boolean);
  }

  /**
   * Sinal do rebalance: a equipe respondeu (mensagem outbound) nas conversas
   * movidas após a redistribuição? Mesma janela de 24h do customer_reply.
   * Positivo parcial já conta: pelo menos uma conversa movida atendida indica
   * que a redistribuição destravou atendimento.
   */
  async _signalRebalanceResponse({ tenantId, executed }) {
    const conversationIds = executed.conversationIds.slice(0, REBALANCE_MAX_MOVES).map(String);
    const base = { type: 'rebalance_response', conversations: conversationIds.length };
    try {
      const executedAt = new Date(executed.executedAt || 0);
      if (!Number.isFinite(executedAt.getTime())) {
        return { ...base, outcome: 'unavailable', reason: 'missing_executed_at' };
      }
      const MessageModel = ChannelMessage();
      const replies = await MessageModel.findAll({
        where: {
          tenant_key: String(tenantId),
          conversation_id: { [Op.in]: conversationIds },
          direction: 'out',
          created_at: { [Op.gt]: executedAt },
        },
        order: [['created_at', 'ASC']],
        limit: 200,
        attributes: ['id', 'conversation_id', 'created_at'],
      });
      const list = (replies || []).map((row) => (row.toJSON ? row.toJSON() : row));
      const handledIds = new Set(list.map((m) => String(m.conversation_id)));
      if (handledIds.size > 0) {
        return {
          ...base,
          outcome: 'handled',
          handledConversations: handledIds.size,
          totalConversations: conversationIds.length,
          firstHandledAt: list[0].created_at || list[0].createdAt || null,
        };
      }
      const elapsedMs = Date.now() - executedAt.getTime();
      if (elapsedMs < REPLY_WINDOW_MS) {
        return { ...base, outcome: 'awaiting_handling', windowHours: REPLY_WINDOW_MS / 3600000 };
      }
      return { ...base, outcome: 'no_handling', windowHours: REPLY_WINDOW_MS / 3600000 };
    } catch (err) {
      return { ...base, outcome: 'unavailable', reason: String(err?.code || err?.message || err) };
    }
  }

  async _signalCustomerReply({ tenantId, executed }) {
    const base = { type: 'customer_reply', conversationId: String(executed.conversationId) };
    try {
      const executedAt = new Date(executed.executedAt || 0);
      if (!Number.isFinite(executedAt.getTime())) {
        return { ...base, outcome: 'unavailable', reason: 'missing_executed_at' };
      }
      const MessageModel = ChannelMessage();
      const replies = await MessageModel.findAll({
        where: {
          tenant_key: String(tenantId),
          conversation_id: String(executed.conversationId),
          direction: 'in',
          created_at: { [Op.gt]: executedAt },
        },
        order: [['created_at', 'ASC']],
        limit: 5,
        attributes: ['id', 'created_at'],
      });
      const list = (replies || []).map((row) => (row.toJSON ? row.toJSON() : row));
      if (list.length > 0) {
        return {
          ...base,
          outcome: 'replied',
          replies: list.length,
          firstReplyAt: list[0].created_at || list[0].createdAt || null,
        };
      }
      const elapsedMs = Date.now() - executedAt.getTime();
      if (elapsedMs < REPLY_WINDOW_MS) {
        return { ...base, outcome: 'awaiting_reply', windowHours: REPLY_WINDOW_MS / 3600000 };
      }
      return { ...base, outcome: 'no_reply', windowHours: REPLY_WINDOW_MS / 3600000 };
    } catch (err) {
      return { ...base, outcome: 'unavailable', reason: String(err?.code || err?.message || err) };
    }
  }

  async _signalTaskCompletion({ tenantId, executed }) {
    const base = { type: 'task_completion', taskId: String(executed.taskId) };
    try {
      const TaskModel = Task();
      const row = await TaskModel.findOne({
        where: { id: String(executed.taskId), tenant_id: String(tenantId) },
      });
      const task = rowToJson(row);
      if (!task) return { ...base, outcome: 'unavailable', reason: 'task_not_found' };
      const status = String(task.status || 'open');
      if (['done', 'completed', 'closed'].includes(status)) {
        return { ...base, outcome: 'done', status };
      }
      if (status === 'cancelled') {
        return { ...base, outcome: 'cancelled', status };
      }
      return { ...base, outcome: 'open', status };
    } catch (err) {
      return { ...base, outcome: 'unavailable', reason: String(err?.code || err?.message || err) };
    }
  }

  _deriveOutcomeFromSignals(signals) {
    if (!Array.isArray(signals) || signals.length === 0) return null;
    const usable = signals.filter((s) => s && s.outcome && s.outcome !== 'unavailable');
    if (usable.length === 0) return null;
    if (usable.some((s) => s.outcome === 'replied' || s.outcome === 'done' || s.outcome === 'handled')) {
      return { outcome: 'improved', reason: 'action_signal_positive' };
    }
    if (usable.some((s) => s.outcome === 'awaiting_reply' || s.outcome === 'open' || s.outcome === 'awaiting_handling')) {
      return { outcome: 'pending', reason: 'awaiting_action_signal', awaitingSignal: true };
    }
    if (usable.some((s) => s.outcome === 'no_reply')) {
      return { outcome: 'unchanged', reason: 'no_customer_reply' };
    }
    if (usable.some((s) => s.outcome === 'no_handling')) {
      return { outcome: 'unchanged', reason: 'no_agent_response' };
    }
    if (usable.some((s) => s.outcome === 'cancelled')) {
      return { outcome: 'unchanged', reason: 'action_cancelled' };
    }
    return null;
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
   * Learn sobre o próprio loop: quando o outcome de um rebalance_queue é
   * 'unchanged' por 'no_agent_response' (a equipe não respondeu nas conversas
   * movidas em 24h), a redistribuição sozinha não bastou. O engine re-observa
   * o contexto (quantos operadores elegíveis existem? quantas conversas movidas
   * seguem abertas?) e gera UMA recomendação de segundo nível, causal:
   * - poucos operadores ativos (<=1) → reforço de equipe/escala;
   * - equipe existe → escalonamento ao gestor para cobrar o atendimento.
   * Guardas anti-loop: apenas 1 follow-up por recomendação (metadata.followUp)
   * e follow-ups nunca geram follow-ups (followUpDepth >= 1). Falha na geração
   * nunca derruba a avaliação — volta explícita no resultado.
   */
  async _maybeCreateRebalanceFollowUp({ tenantId, row, outcome }) {
    try {
      if (!row || !outcome) return null;
      if (outcome.outcome !== 'unchanged' || outcome.reason !== 'no_agent_response') return null;

      const current = rowToJson(row);
      const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
      const executed = metadata.application?.executedAction;
      if (!executed || executed.kind !== 'rebalance_queue' || executed.status !== 'executed') return null;
      if (metadata.followUp) return null;
      if ((metadata.followUpDepth || 0) >= 1) return null;

      const diagnosis = await this._diagnoseRebalanceFailure({ tenantId, executed });
      const variant = diagnosis.eligibleAgents != null && diagnosis.eligibleAgents <= 1
        ? 'staffing_review'
        : 'manager_escalation';

      const moved = diagnosis.totalMoved != null ? `${diagnosis.totalMoved} conversa(s)` : 'as conversas';
      const stillOpen = diagnosis.stillOpen != null && diagnosis.stillOpen > 0
        ? ` e ${diagnosis.stillOpen} seguem abertas`
        : '';
      const title = variant === 'staffing_review'
        ? 'Reforçar a equipe de atendimento'
        : 'Escalar atendimentos sem resposta para o gestor';
      const description = variant === 'staffing_review'
        ? `A redistribuição de ${moved} não destravou o atendimento${stillOpen} e há apenas ${diagnosis.eligibleAgents} operador(es) ativo(s) — a fila não tem capacidade de resposta. Avalie reforço de equipe ou revisão de escalas.`
        : `A redistribuição de ${moved} não destravou o atendimento: nenhuma resposta da equipe em 24h${stillOpen}. Um gestor precisa revisar a fila e cobrar o atendimento.`;

      const createdItem = await this.createRecommendation({
        tenantId,
        payload: {
          insightId: current.insight_id || null,
          title,
          description,
          actionType: variant,
          priority: 'high',
          estimatedImpact: { expected: 'high', horizon: 'short_term' },
          metadata: {
            relatedMetrics: Array.isArray(metadata.relatedMetrics) ? metadata.relatedMetrics : [],
            followUpOf: current.id,
            followUpDepth: (metadata.followUpDepth || 0) + 1,
            followUpReason: 'no_agent_response',
            rebalanceDiagnosis: diagnosis,
          },
          action: {
            kind: 'create_task',
            label: variant === 'staffing_review'
              ? 'Criar tarefa de reforço de equipe'
              : 'Criar tarefa de escalonamento',
          },
        },
      });

      // Marca no pai DEPOIS da criação: se a criação falhar, uma próxima
      // avaliação pode tentar de novo (não perde o follow-up silenciosamente).
      await row.update({
        metadata: {
          ...rowToJson(row).metadata,
          followUp: {
            createdRecommendationId: createdItem.id,
            createdAt: new Date().toISOString(),
            reason: 'no_agent_response',
            variant,
          },
        },
      });

      return { created: true, recommendationId: createdItem.id, variant, diagnosis };
    } catch (err) {
      return { created: false, error: String(err?.code || err?.message || err) };
    }
  }

  /**
   * Re-observação causal do rebalance que não destravou atendimento.
   * Fail-soft por fonte: indisponibilidade de agentes ou de conversas fica
   * explícita no diagnóstico, sem impedir a geração do follow-up.
   */
  async _diagnoseRebalanceFailure({ tenantId, executed }) {
    const conversationIds = Array.isArray(executed.conversationIds)
      ? executed.conversationIds.slice(0, REBALANCE_MAX_MOVES).map(String)
      : [];
    const diagnosis = {
      totalMoved: conversationIds.length,
      eligibleAgents: null,
      stillOpen: null,
    };

    try {
      const agents = await this.authService.listAgents(String(tenantId));
      const eligible = (agents || []).filter((agent) => agent
        && agent.active !== false
        && (!agent.status || agent.status === 'active')
        && ELIGIBLE_ASSIGNEE_ROLES.has(agent.role));
      diagnosis.eligibleAgents = eligible.length;
    } catch (err) {
      diagnosis.agentsError = String(err?.code || err?.message || err);
    }

    if (conversationIds.length > 0) {
      try {
        const ConversationModel = ChannelConversation();
        const rows = await ConversationModel.findAll({
          where: {
            tenant_key: String(tenantId),
            id: { [Op.in]: conversationIds },
            status: 'open',
          },
          attributes: ['id'],
        });
        diagnosis.stillOpen = (rows || []).length;
      } catch (err) {
        diagnosis.conversationsError = String(err?.code || err?.message || err);
      }
    }

    return diagnosis;
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

      // Recomendações sem baseline de métricas mas com ação executada são
      // avaliadas pelo sinal comportamental (resposta do cliente, tarefa
      // concluída) — o loop não depende só de snapshot novo.
      const hasActionSignal = reco.metadata?.application?.executedAction?.status === 'executed';
      if (!hasNewSnapshot && !hasActionSignal) {
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

  _enrichMappedRecommendation(mapped, insight) {
    const metadata = insight?.metadata && typeof insight.metadata === 'object' ? insight.metadata : {};
    const causes = Array.isArray(metadata.probableCauses) ? metadata.probableCauses : [];
    const projection = metadata.projection && typeof metadata.projection === 'object' ? metadata.projection : null;

    if (causes.length > 0) mapped.metadata.probableCauses = causes;
    if (projection) mapped.metadata.projection = projection;

    const suffix = [];
    if (causes.length > 0) {
      suffix.push(`Possiveis causas: ${causes
        .map((cause) => `${cause.label || cause.metricKey} (${cause.direction === 'up' ? '+' : ''}${Math.round(cause.changeRatio * 100)}%)`)
        .join(', ')}`);
    }
    if (projection) {
      const label = projection.projectedStatus === 'will_meet' ? 'atinge a meta' : 'nao atinge a meta';
      suffix.push(`Projecao de fechamento: ~${projection.projectedValue} vs alvo ${projection.targetValue} (${label})`);
    }
    if (suffix.length > 0) mapped.description = `${mapped.description} ${suffix.join('. ')}.`;
  }

  /**
   * Recomendação com ação operacional executável quando a causa provável é
   * o tempo de primeira resposta em alta: em vez de "criar tarefa de
   * investigação", o apply redistribui as conversas abertas da fila.
   */
  _rebalanceRecommendation({ insight, type, goalId, relatedMetrics, responseCause }) {
    return {
      insightId: insight.id,
      goalId: goalId || null,
      title: 'Redistribuir atendimentos para destravar a primeira resposta',
      description: `A queda de desempenho coincide com aumento de ${Math.round((responseCause.changeRatio || 0) * 100)}% no tempo medio de primeira resposta. Redistribuir as conversas abertas entre a equipe tende a destravar o atendimento.`,
      actionType: 'rebalance_queue',
      priority: 'high',
      estimatedImpact: { expected: 'high', horizon: 'short_term' },
      metadata: {
        sourceInsightType: type,
        relatedMetrics,
      },
      action: { kind: 'rebalance_queue', label: 'Redistribuir conversas abertas' },
    };
  }

  _mapInsightToRecommendation(insight, goals) {
    if (!insight || !insight.id) return null;

    const type = String(insight.type || 'generic_insight');
    const relatedMetrics = Array.isArray(insight.related_metrics) ? insight.related_metrics : [];
    const goalFromInsight = insight.metadata?.goalId || null;
    const matchedGoal = goalFromInsight
      ? (goals || []).find((goal) => String(goal.id) === String(goalFromInsight))
      : null;
    const responseCause = firstResponseCause(insight);

    if (type === 'goal_off_track') {
      if (responseCause) {
        return this._rebalanceRecommendation({
          insight, type, goalId: matchedGoal?.id || goalFromInsight, relatedMetrics, responseCause,
        });
      }
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
      if (responseCause) {
        return this._rebalanceRecommendation({
          insight, type, goalId: matchedGoal?.id, relatedMetrics, responseCause,
        });
      }
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
      if (responseCause) {
        return this._rebalanceRecommendation({
          insight, type, goalId: matchedGoal?.id || goalFromInsight, relatedMetrics, responseCause,
        });
      }
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

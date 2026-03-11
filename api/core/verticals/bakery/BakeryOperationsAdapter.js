'use strict';

/**
 * Bakery Operations Adapter
 * 
 * Especializa o ServiceOperationsKernel para operações de padaria,
 * sem duplicar o core.
 * 
 * Responsabilidade:
 * - Adaptar eventos, sinais, decisões e ações para vocabulário bakery
 * - Integrar decisões específicas da padaria
 * - Coordenar com VerticalTemplateRegistry para defaults
 * 
 * Loop operacional:
 * evento bakery → estado bakery → decisão bakery → ação bakery → outcome bakery
 */

const { BAKERY_EVENTS } = require('./bakeryEvents');
const { BAKERY_DECISION_POLICIES, BAKERY_DECISION_WORKFLOW } = require('./bakeryPolicies');
const { BAKERY_KPI_SET, BAKERY_KPI_AUTOMATIONS } = require('./bakeryKpis');

class BakeryOperationsAdapter {
  constructor(kernel) {
    if (!kernel) {
      throw new Error('BakeryOperationsAdapter requires ServiceOperationsKernel instance');
    }
    this.kernel = kernel;
    this.verticalName = 'bakery';
    this.vocabulary = this._buildVocabulary();
  }

  /**
   * Construir vocabulário da padaria
   * Mapeia entidades e relacionamentos específicos
   */
  _buildVocabulary() {
    return {
      entities: {
        order: 'order',
        preorder: 'preorder',
        queue: 'queue',
        oven: 'oven',
        customer: 'customer',
        inventory: 'inventory',
      },
      contexts: {
        counter: 'balcão',
        phone: 'telefone',
        whatsapp: 'whatsapp',
        delivery: 'entrega',
        pickup: 'retirada',
        production: 'produção',
      },
      windows: {
        rush: 'janela de pico',
        idle: 'janela ociosa',
        quiet: 'horário silencioso',
      },
    };
  }

  /**
   * Ingerir evento específico de padaria
   * Converte para formato canônico e passa ao kernel
   */
  async ingestBakeryEvent({ type, payload, source = 'bakery-system', tenantId, correlationId } = {}) {
    if (!BAKERY_EVENTS[type]) {
      throw new Error(`Unknown bakery event type: ${type}`);
    }

    const eventDef = BAKERY_EVENTS[type];

    // Normalizar payload
    const normalizedPayload = {
      ...payload,
      vertical: this.verticalName,
      eventDefinition: eventDef,
    };

    // Passar ao kernel para ingestão canônica
    return this.kernel.ingestEvent({
      type,
      payload: normalizedPayload,
      source,
      tenantId,
      correlationId,
      subject: payload.subject || { type: eventDef.subjects[0] },
    });
  }

  /**
   * Gerar decisões especializadas para padaria
   * Aplica policies de bakery ao estado operacional
   */
  async generateBakeryDecisions({ tenantId, eventId, eventType, eventPayload } = {}) {
    // Recuperar contexto operacional do kernel
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });

    // Classificar tipo de evento de padaria
    const eventCategory = this._classifyBakeryEvent(eventType);

    // Buscar policies aplicáveis
    const applicablePolicies = this._selectPolicies(eventCategory, eventPayload, occState);

    // Executar decisão via kernel
    const decisions = await Promise.all(
      applicablePolicies.map((policy) =>
        this.kernel.decisionEngine.decide({
          tenantId,
          eventId,
          policyId: policy.id,
          context: {
            vertical: this.verticalName,
            eventType,
            eventPayload,
            occState,
            policy,
          },
        })
      )
    );

    return decisions;
  }

  /**
   * Executar ação bakery (quick action ou playbook)
   * Delega ao kernel mas com contexto de bakery
   */
  async executeBakeryAction({ tenantId, actionId, actionType, parameters = {} } = {}) {
    return this.kernel.actionsService.execute({
      tenantId,
      actionId,
      actionType,
      parameters: {
        ...parameters,
        vertical: this.verticalName,
      },
    });
  }

  /**
   * Registrar outcome específico de bakery
   * Aprendizado e outcome tracking
   */
  async recordBakeryOutcome({ tenantId, eventId, decisionId, actionId, result, metrics = {} } = {}) {
    return this.kernel.outcomesService.recordOutcome({
      tenantId,
      eventId,
      decisionId,
      actionId,
      result,
      metrics: {
        ...metrics,
        vertical: this.verticalName,
      },
    });
  }

  /**
   * Gerar sinais específicos de bakery
   * Detectar padrões operacionais
   */
  async generateBakerySinais({ tenantId, scope = 'tenant' } = {}) {
    const baseSignals = await this.kernel.signalsService.generateForTenant({ tenantId });

    // Filtrar e especializar para bakery
    const bakerySignals = baseSignals.filter((signal) =>
      this._isBakeryRelevantSignal(signal)
    );

    return {
      baseSignals: baseSignals.length,
      bakerySignals: bakerySignals,
      specializations: {
        rushWindowDetected: this._detectRushWindow(baseSignals),
        idleWindowDetected: this._detectIdleWindow(baseSignals),
        customerChurnRisk: this._assessCustomerChurnRisk(baseSignals),
        queueFillRisk: this._assessQueueFillRisk(baseSignals),
      },
    };
  }

  /**
   * Recuperar estado operacional de bakery
   * Projeção especializada
   */
  async getBakeryOperationalState({ tenantId } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });

    return {
      orders: occState?.orders || [],
      queue: this._projectQueueState(occState),
      production: this._projectProductionState(occState),
      inventory: this._projectInventoryState(occState),
      demandWindow: this._assessDemandWindow(occState),
      customers: this._projectCustomerState(occState),
      kpis: this._calculateBakeryKpis(occState),
    };
  }

  /**
   * Listar quick actions recomendadas para padaria
   */
  async listBakeryQuickActions({ tenantId, context = {} } = {}) {
    const occState = await this.getBakeryOperationalState({ tenantId });

    const recommendedActions = this._selectQuickActions(occState, context);

    return recommendedActions.map((action) => ({
      id: action.id,
      name: action.name,
      description: action.description,
      applicableWhen: action.applicableWhen,
      expectedOutcome: action.expectedOutcome,
      trigger: action.trigger,
    }));
  }

  /**
   * Listar playbooks recomendados para padaria
   */
  async listBakeryPlaybooks({ tenantId, scenario } = {}) {
    if (!scenario) {
      throw new Error('Scenario required (e.g., rush_management, pickup_delay, reactivation)');
    }

    const recommendedPlaybooks = this._selectPlaybooks(scenario);

    return recommendedPlaybooks;
  }

  // ========== HELPER METHODS ==========

  _classifyBakeryEvent(eventType) {
    if (eventType.includes('order')) return 'order_lifecycle';
    if (eventType.includes('queue')) return 'queue_management';
    if (eventType.includes('oven')) return 'production';
    if (eventType.includes('pickup')) return 'pickup_management';
    if (eventType.includes('preorder')) return 'preorder_management';
    if (eventType.includes('rush') || eventType.includes('idle')) return 'demand_management';
    if (eventType.includes('customer')) return 'customer_lifecycle';
    if (eventType.includes('inventory')) return 'inventory_management';
    return 'unknown';
  }

  _selectPolicies(category, payload, occState) {
    const policies = [];

    // Mapear category para policies
    if (category === 'order_lifecycle' && BAKERY_DECISION_POLICIES.orderPriority) {
      policies.push(...BAKERY_DECISION_POLICIES.orderPriority.rules.map((r, i) => ({
        id: `order_priority_${i}`,
        ...r,
      })));
    }

    if (category === 'queue_management' && BAKERY_DECISION_POLICIES.queueManagement) {
      policies.push(...BAKERY_DECISION_POLICIES.queueManagement.rules.map((r, i) => ({
        id: `queue_management_${i}`,
        ...r,
      })));
    }

    // ... outras políticas por categoria

    return policies;
  }

  _isBakeryRelevantSignal(signal) {
    // Filtrar sinais relevantes para padaria
    return signal.contexts?.some((c) => Object.values(this.vocabulary.contexts).includes(c));
  }

  _detectRushWindow(_signals) {
    // Lógica de detecção de pico
    return { detected: false, confidence: 0 };
  }

  _detectIdleWindow(_signals) {
    // Lógica de detecção de ociosidade
    return { detected: false, confidence: 0 };
  }

  _assessCustomerChurnRisk(_signals) {
    // Avaliar risco de churn de clientes recorrentes
    return { riskLevel: 'low', affectedCustomers: 0 };
  }

  _assessQueueFillRisk(_signals) {
    // Avaliar risco de fila preencher
    return { riskLevel: 'low', predictedWaitTime: 0 };
  }

  _projectQueueState(occState) {
    return { length: 0, waitTime: 0, status: 'normal' };
  }

  _projectProductionState(occState) {
    return { ovenUtilization: 0, activeProduction: 0, status: 'idle' };
  }

  _projectInventoryState(occState) {
    return { products: [], lowStockItems: [], status: 'healthy' };
  }

  _assessDemandWindow(occState) {
    return { window: 'normal', peakForecast: false, confidence: 0 };
  }

  _projectCustomerState(occState) {
    return { recurring: 0, atRisk: 0, reactivationEligible: 0 };
  }

  _calculateBakeryKpis(occState) {
    return {
      ticketMedio: 0,
      waitTime: 0,
      fulfillmentRate: 0,
      customerRetention: 0,
    };
  }

  _selectQuickActions(occState, context) {
    const actions = [];

    if (occState.queue?.length > 5) {
      actions.push({
        id: 'call_staff',
        name: 'Chamar Colaborador',
        description: 'Convocar colaborador adicional para fila',
        trigger: 'queue_overflow',
      });
    }

    // ... mais ações baseado no estado

    return actions;
  }

  _selectPlaybooks(scenario) {
    const playbookMap = {
      rush_management: [
        { id: 'rush_production_prep', name: 'Preparação de Produção para Pico' },
      ],
      pickup_delay: [
        { id: 'pickup_reminder', name: 'Lembrete de Retirada' },
      ],
      reactivation: [
        { id: 'reactivation_campaign', name: 'Campanha de Reativação' },
      ],
    };

    return playbookMap[scenario] || [];
  }
}

module.exports = {
  BakeryOperationsAdapter,
};

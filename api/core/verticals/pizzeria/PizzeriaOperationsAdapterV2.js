'use strict';

/**
 * Pizzeria Operations Adapter (Expandido)
 * 
 * Especializa o ServiceOperationsKernel para operações de pizzaria,
 * sem duplicar o core.
 */

const { PIZZERIA_EVENTS } = require('./PizzeriaOperationsAdapter');
const { PIZZERIA_DECISION_POLICIES, PIZZERIA_KPI_SET } = require('./PizzeriaOperationsAdapter');

class PizzeriaOperationsAdapterV2 {
  constructor(kernel) {
    if (!kernel) {
      throw new Error('PizzeriaOperationsAdapter requires ServiceOperationsKernel instance');
    }
    this.kernel = kernel;
    this.verticalName = 'pizzeria';
    this.vocabulary = this._buildVocabulary();
  }

  _buildVocabulary() {
    return {
      entities: {
        order: 'order',
        oven: 'oven',
        driver: 'driver',
        route: 'route',
        customer: 'customer',
      },
      contexts: {
        counter: 'balcão',
        phone: 'telefone',
        whatsapp: 'whatsapp',
        delivery: 'entrega',
        production: 'produção',
      },
      windows: {
        rush: 'horário de pico',
        idle: 'horário ocioso',
      },
    };
  }

  async ingestPizzeriaEvent({ type, payload, source = 'pizzeria-system', tenantId, correlationId } = {}) {
    if (!PIZZERIA_EVENTS[type]) {
      throw new Error(`Unknown pizzeria event type: ${type}`);
    }

    const normalizedPayload = {
      ...payload,
      vertical: this.verticalName,
    };

    return this.kernel.ingestEvent({
      type,
      payload: normalizedPayload,
      source,
      tenantId,
      correlationId,
    });
  }

  async generatePizzeriaDecisions({ tenantId, eventId, eventType, eventPayload } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });
    const eventCategory = this._classifyEvent(eventType);
    const applicablePolicies = this._selectPolicies(eventCategory, eventPayload, occState);

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

  async executePizzeriaAction({ tenantId, actionId, actionType, parameters = {} } = {}) {
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

  async recordPizzeriaOutcome({ tenantId, eventId, decisionId, actionId, result, metrics = {} } = {}) {
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

  async generatePizzeriaSignals({ tenantId } = {}) {
    const baseSignals = await this.kernel.signalsService.generateForTenant({ tenantId });
    const pizzeriaSignals = baseSignals.filter((signal) => this._isPizzeriaRelevant(signal));

    return {
      baseSignals: baseSignals.length,
      pizzeriaSignals,
      specializations: {
        ovenOverloadDetected: this._detectOvenOverload(baseSignals),
        deliveryDelayRisk: this._detectDeliveryDelayRisk(baseSignals),
        rushWindowDetected: this._detectRushWindow(baseSignals),
      },
    };
  }

  async getPizzeriaOperationalState({ tenantId } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });

    return {
      orders: occState?.orders || [],
      ovenStatus: this._projectOvenStatus(occState),
      deliveryFleet: this._projectDeliveryStatus(occState),
      demandWindow: this._assessDemandWindow(occState),
      customers: this._projectCustomerState(occState),
      kpis: this._calculatePizzeriaKpis(occState),
    };
  }

  async listPizzeriaQuickActions({ tenantId, context = {} } = {}) {
    const occState = await this.getPizzeriaOperationalState({ tenantId });
    const recommendedActions = this._selectQuickActions(occState, context);

    return recommendedActions.map((action) => ({
      id: action.id,
      name: action.name,
      description: action.description,
      trigger: action.trigger,
    }));
  }

  async listPizzeriaPlaybooks({ tenantId, scenario } = {}) {
    if (!scenario) throw new Error('Scenario required');
    return this._selectPlaybooks(scenario);
  }

  // ========== HELPERS ==========

  _classifyEvent(eventType) {
    if (eventType.includes('pizza_order')) return 'order_lifecycle';
    if (eventType.includes('oven')) return 'production';
    if (eventType.includes('delivery')) return 'delivery_management';
    if (eventType.includes('customer')) return 'customer_lifecycle';
    return 'unknown';
  }

  _selectPolicies(category, payload, occState) {
    const policies = [];

    if (category === 'production' && PIZZERIA_DECISION_POLICIES.ovenManagement) {
      policies.push(...PIZZERIA_DECISION_POLICIES.ovenManagement.rules.map((r, i) => ({
        id: `oven_mgmt_${i}`,
        ...r,
      })));
    }

    if (category === 'delivery_management' && PIZZERIA_DECISION_POLICIES.deliveryOptimization) {
      policies.push(...PIZZERIA_DECISION_POLICIES.deliveryOptimization.rules.map((r, i) => ({
        id: `delivery_opt_${i}`,
        ...r,
      })));
    }

    return policies;
  }

  _isPizzeriaRelevant(signal) {
    return signal.contexts?.some((c) => Object.values(this.vocabulary.contexts).includes(c));
  }

  _detectOvenOverload(_signals) {
    return { detected: false, confidence: 0, severity: 'low' };
  }

  _detectDeliveryDelayRisk(_signals) {
    return { detected: false, confidence: 0, affectedOrders: 0 };
  }

  _detectRushWindow(_signals) {
    return { detected: false, confidence: 0 };
  }

  _projectOvenStatus(occState) {
    return { utilization: 0, slots: [], status: 'idle', activeProductions: 0 };
  }

  _projectDeliveryStatus(occState) {
    return { activeDrivers: 0, avgDeliveryTime: 0, routes: [], status: 'idle' };
  }

  _assessDemandWindow(occState) {
    return { window: 'normal', peakForecast: false, confidence: 0 };
  }

  _projectCustomerState(occState) {
    return { recurring: 0, atRisk: 0, reactivationEligible: 0 };
  }

  _calculatePizzeriaKpis(occState) {
    return {
      productionTime: 0,
      deliveryTime: 0,
      ticketMedio: 0,
      ovenUtilization: 0,
      deliverySuccessRate: 0,
    };
  }

  _selectQuickActions(occState, context) {
    const actions = [];

    if (occState.ovenStatus?.utilization > 80) {
      actions.push({
        id: 'defer_non_urgent',
        name: 'Adiar Pedidos Não Urgentes',
        description: 'Forno está no limite',
        trigger: 'oven_overload',
      });
    }

    if (occState.deliveryFleet?.activeDrivers === 0) {
      actions.push({
        id: 'alert_dispatch',
        name: 'Alerta de Despacho',
        description: 'Sem drivers disponíveis',
      });
    }

    return actions;
  }

  _selectPlaybooks(scenario) {
    const playbookMap = {
      oven_management: [
        { id: 'oven_prep', name: 'Preparação para Pico' },
      ],
      delivery_optimization: [
        { id: 'batch_delivery', name: 'Agrupar Entregas' },
      ],
      rush_management: [
        { id: 'rush_prod_prep', name: 'Preparação de Produção para Pico' },
      ],
    };

    return playbookMap[scenario] || [];
  }
}

module.exports = {
  PizzeriaOperationsAdapterV2,
};

'use strict';

/**
 * Market Operations Adapter (Expandido)
 * 
 * Especializa o ServiceOperationsKernel para operações de mercado,
 * sem duplicar o core.
 */

const { MARKET_EVENTS } = require('./MarketOperationsAdapter');
const { MARKET_DECISION_POLICIES, MARKET_KPI_SET } = require('./MarketOperationsAdapter');

class MarketOperationsAdapterV2 {
  constructor(kernel) {
    if (!kernel) {
      throw new Error('MarketOperationsAdapter requires ServiceOperationsKernel instance');
    }
    this.kernel = kernel;
    this.verticalName = 'market';
    this.vocabulary = this._buildVocabulary();
  }

  _buildVocabulary() {
    return {
      entities: {
        order: 'order',
        product: 'product',
        inventory: 'inventory',
        customer: 'customer',
        promotion: 'promotion',
      },
      contexts: {
        pickup: 'retirada',
        delivery: 'entrega',
        online: 'online',
        instore: 'loja',
      },
    };
  }

  async ingestMarketEvent({ type, payload, source = 'market-system', tenantId, correlationId } = {}) {
    if (!MARKET_EVENTS[type]) {
      throw new Error(`Unknown market event type: ${type}`);
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

  async generateMarketDecisions({ tenantId, eventId, eventType, eventPayload } = {}) {
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

  async executeMarketAction({ tenantId, actionId, actionType, parameters = {} } = {}) {
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

  async recordMarketOutcome({ tenantId, eventId, decisionId, actionId, result, metrics = {} } = {}) {
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

  async generateMarketSignals({ tenantId } = {}) {
    const baseSignals = await this.kernel.signalsService.generateForTenant({ tenantId });
    const marketSignals = baseSignals.filter((signal) => this._isMarketRelevant(signal));

    return {
      baseSignals: baseSignals.length,
      marketSignals,
      specializations: {
        inventoryRisk: this._detectInventoryRisk(baseSignals),
        customerPatternDetected: this._detectCustomerPattern(baseSignals),
        promotionOpportunity: this._detectPromotionOpportunity(baseSignals),
      },
    };
  }

  async getMarketOperationalState({ tenantId } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });

    return {
      inventory: this._projectInventoryState(occState),
      orders: this._projectOrderState(occState),
      fulfillment: this._projectFulfillmentState(occState),
      customers: this._projectCustomerState(occState),
      promotions: this._projectPromotionState(occState),
      kpis: this._calculateMarketKpis(occState),
    };
  }

  async listMarketQuickActions({ tenantId, context = {} } = {}) {
    const occState = await this.getMarketOperationalState({ tenantId });
    const recommendedActions = this._selectQuickActions(occState, context);

    return recommendedActions.map((action) => ({
      id: action.id,
      name: action.name,
      description: action.description,
      trigger: action.trigger,
    }));
  }

  async listMarketPlaybooks({ tenantId, scenario } = {}) {
    if (!scenario) throw new Error('Scenario required');
    return this._selectPlaybooks(scenario);
  }

  // ========== HELPERS ==========

  _classifyEvent(eventType) {
    if (eventType.includes('order')) return 'order_lifecycle';
    if (eventType.includes('inventory')) return 'inventory_management';
    if (eventType.includes('promotion')) return 'promotion_management';
    if (eventType.includes('customer')) return 'customer_lifecycle';
    return 'unknown';
  }

  _selectPolicies(category, payload, occState) {
    const policies = [];

    if (category === 'inventory_management' && MARKET_DECISION_POLICIES.inventoryManagement) {
      policies.push(...MARKET_DECISION_POLICIES.inventoryManagement.rules.map((r, i) => ({
        id: `inventory_mgmt_${i}`,
        ...r,
      })));
    }

    if (category === 'order_lifecycle' && MARKET_DECISION_POLICIES.fulfillmentRouting) {
      policies.push(...MARKET_DECISION_POLICIES.fulfillmentRouting.rules.map((r, i) => ({
        id: `fulfillment_route_${i}`,
        ...r,
      })));
    }

    return policies;
  }

  _isMarketRelevant(signal) {
    return signal.contexts?.some((c) => Object.values(this.vocabulary.contexts).includes(c));
  }

  _detectInventoryRisk(_signals) {
    return { detected: false, confidence: 0, affectedProducts: 0 };
  }

  _detectCustomerPattern(_signals) {
    return { detected: false, confidence: 0, patternType: null };
  }

  _detectPromotionOpportunity(_signals) {
    return { detected: false, confidence: 0, suggestedType: null };
  }

  _projectInventoryState(occState) {
    return { products: 0, lowStock: 0, outOfStock: 0, turnover: 0 };
  }

  _projectOrderState(occState) {
    return { pending: 0, processing: 0, ready: 0, shipped: 0 };
  }

  _projectFulfillmentState(occState) {
    return { activeDeliveries: 0, avgDeliveryTime: 0, routes: 0 };
  }

  _projectCustomerState(occState) {
    return { total: 0, recurring: 0, atRisk: 0, reactivationEligible: 0 };
  }

  _projectPromotionState(occState) {
    return { active: 0, running: 0, scheduled: 0 };
  }

  _calculateMarketKpis(occState) {
    return {
      fulfillmentTime: 0,
      stockAvailability: 0,
      ticketMedio: 0,
      repeatPurchaseRate: 0,
      customerLifetimeValue: 0,
    };
  }

  _selectQuickActions(occState, context) {
    const actions = [];

    if (occState.inventory?.outOfStock > 0) {
      actions.push({
        id: 'stock_alert',
        name: 'Alerta de Falta de Estoque',
        description: 'Notificar clientes sobre substituição',
        trigger: 'out_of_stock',
      });
    }

    if (occState.customers?.recurring > 50) {
      actions.push({
        id: 'loyalty_promotion',
        name: 'Promoção de Fidelização',
        description: 'Oferta especial para clientes recorrentes',
      });
    }

    return actions;
  }

  _selectPlaybooks(scenario) {
    const playbookMap = {
      inventory_management: [
        { id: 'restock_alert', name: 'Alerta de Reposição' },
      ],
      fulfillment_optimization: [
        { id: 'batch_delivery', name: 'Agrupar Entregas' },
      ],
      customer_engagement: [
        { id: 'reactivation_campaign', name: 'Campanha de Reativação' },
      ],
    };

    return playbookMap[scenario] || [];
  }
}

module.exports = {
  MarketOperationsAdapterV2,
};

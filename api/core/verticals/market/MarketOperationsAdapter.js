'use strict';

const MARKET_EVENTS = Object.freeze({
  'market:order.created': { priority: 'high', triggers: ['inventory_check', 'payment_processing'] },
  'market:order.confirmed': { priority: 'high', triggers: ['fulfillment_scheduling'] },
  'market:order.ready_for_pickup': { priority: 'high', triggers: ['customer_notification'] },
  'market:order.out_for_delivery': { priority: 'high', triggers: ['delivery_tracking'] },
  'market:order.delivered': { priority: 'medium', triggers: ['revenue_posting', 'reorder_reminder'] },
  'market:order.cancelled': { priority: 'high', triggers: ['inventory_release', 'retention_outreach'] },
  'market:inventory.low_stock': { priority: 'high', triggers: ['reorder_alert', 'availability_update'] },
  'market:inventory.out_of_stock': { priority: 'critical', triggers: ['customer_notification', 'substitute_suggestion'] },
  'market:promotion.triggered': { priority: 'medium', triggers: ['customer_notification', 'tracking'] },
  'market:customer.purchase_pattern_detected': { priority: 'medium', triggers: ['recommendation_engine', 'loyalty_check'] },
  'market:customer.reactivation_due': { priority: 'medium', triggers: ['reactivation_campaign'] },
});

const MARKET_DECISION_POLICIES = Object.freeze({
  inventoryManagement: {
    rules: [
      { condition: 'stock_below_reorder_level', decision: 'trigger_reorder' },
      { condition: 'out_of_stock && substitute_available', decision: 'suggest_substitute' },
      { condition: 'overstock && slow_moving', decision: 'trigger_promotion' },
    ],
  },
  fulfillmentRouting: {
    rules: [
      { condition: 'same_store_available', decision: 'local_fulfillment' },
      { condition: 'geographically_close_orders', decision: 'batch_delivery' },
      { condition: 'premium_customer && expedited_available', decision: 'offer_expedited' },
    ],
  },
  customerEngagement: {
    rules: [
      { condition: 'repeat_purchase_pattern', decision: 'loyalty_bonus' },
      { condition: 'inactive_30days', decision: 'reactivation_campaign' },
      { condition: 'high_basket_value', decision: 'vip_service' },
    ],
  },
});

const MARKET_KPI_SET = Object.freeze({
  order_fulfillment_time: { target: 24, alert: { warning: 48, critical: 72 }, unit: 'hours' },
  stock_availability: { target: 95, alert: { low: 85 }, unit: '%' },
  inventory_turnover: { target: 6, alert: { low: 4 }, unit: 'turns/month' },
  ticket_medio: { target: 120, alert: { low: 80, high: 200 }, unit: 'BRL' },
  repeat_purchase_rate: { target: 45, alert: { low: 30 }, unit: '%' },
  customer_lifetime_value: { target: 1500, alert: { low: 800 }, unit: 'BRL' },
  promotion_roi: { target: 200, alert: { low: 150 }, unit: '%' },
});

class MarketOperationsAdapter {
  constructor(kernel) {
    this.kernel = kernel;
    this.verticalName = 'market';
  }

  async ingestMarketEvent({ type, payload, tenantId }) {
    return this.kernel.ingestEvent({
      type,
      payload: { ...payload, vertical: this.verticalName },
      tenantId,
    });
  }

  async generateMarketDecisions({ tenantId, eventType, eventPayload }) {
    return this.kernel.decisionEngine.decide({
      tenantId,
      context: {
        vertical: this.verticalName,
        eventType,
        eventPayload,
      },
    });
  }

  async getMarketOperationalState({ tenantId }) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });
    return {
      inventory: this._projectInventoryState(occState),
      orders: this._projectOrderState(occState),
      fulfillment: this._projectFulfillmentState(occState),
      customers: this._projectCustomerState(occState),
      kpis: this._calculateKpis(occState),
    };
  }

  _projectInventoryState(occState) {
    return { products: [], lowStockItems: [], outOfStock: [], utilization: 0 };
  }

  _projectOrderState(occState) {
    return { pending: 0, processing: 0, ready: 0, shipped: 0 };
  }

  _projectFulfillmentState(occState) {
    return { activeDeliveries: 0, avgDeliveryTime: 0, routes: [] };
  }

  _projectCustomerState(occState) {
    return { total: 0, recurring: 0, atRisk: 0, reactivationEligible: 0 };
  }

  _calculateKpis(occState) {
    return MARKET_KPI_SET;
  }
}

module.exports = {
  MarketOperationsAdapter,
  MARKET_EVENTS,
  MARKET_DECISION_POLICIES,
  MARKET_KPI_SET,
};

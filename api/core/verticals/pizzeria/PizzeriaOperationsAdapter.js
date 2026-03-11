'use strict';

const PIZZERIA_EVENTS = Object.freeze({
  'pizzeria:pizza_order.created': { priority: 'high', triggers: ['production_scheduling'] },
  'pizzeria:pizza_order.confirmed': { priority: 'high', triggers: ['oven_slot_assignment'] },
  'pizzeria:pizza_order.in_production': { priority: 'medium', triggers: ['oven_monitor'] },
  'pizzeria:pizza_order.ready': { priority: 'high', triggers: ['delivery_dispatch_or_pickup'] },
  'pizzeria:pizza_order.out_for_delivery': { priority: 'high', triggers: ['delivery_tracking', 'customer_notification'] },
  'pizzeria:pizza_order.delivered': { priority: 'medium', triggers: ['revenue_posting', 'satisfaction_survey'] },
  'pizzeria:pizza_order.cancelled': { priority: 'high', triggers: ['oven_release', 'retention_outreach'] },
  'pizzeria:pizza_oven.slot_available': { priority: 'high', triggers: ['production_dispatch'] },
  'pizzeria:pizza_oven.overload': { priority: 'critical', triggers: ['defer_orders', 'alert_manager'] },
  'pizzeria:delivery.driver_assigned': { priority: 'high', triggers: ['delivery_tracking'] },
  'pizzeria:delivery.delay_risk': { priority: 'high', triggers: ['customer_notification', 'driver_support'] },
  'pizzeria:customer.reactivation_due': { priority: 'medium', triggers: ['reactivation_campaign'] },
});

const PIZZERIA_DECISION_POLICIES = Object.freeze({
  ovenManagement: {
    rules: [
      { condition: 'oven_load > 85%', decision: 'defer_non_urgent' },
      { condition: 'delivery_delay_risk_high', decision: 'prioritize_ready_orders' },
      { condition: 'demand_spike', decision: 'accelerate_production' },
    ],
  },
  deliveryOptimization: {
    rules: [
      { condition: 'same_route_available', decision: 'batch_delivery' },
      { condition: 'region_demand_high', decision: 'assign_dedicated_driver' },
      { condition: 'delay_risk_detected', decision: 'proactive_customer_alert' },
    ],
  },
});

const PIZZERIA_KPI_SET = Object.freeze({
  production_time: { target: 20, alert: { warning: 30, critical: 40 }, unit: 'min' },
  delivery_time: { target: 45, alert: { warning: 60, critical: 75 }, unit: 'min' },
  ticket_medio: { target: 65, alert: { low: 50, high: 85 }, unit: 'BRL' },
  oven_utilization: { target: 80, alert: { low: 60, high: 95 }, unit: '%' },
  batch_efficiency: { target: 70, alert: { low: 50 }, unit: '%' },
  delivery_success_rate: { target: 98, alert: { low: 95 }, unit: '%' },
});

class PizzeriaOperationsAdapter {
  constructor(kernel) {
    this.kernel = kernel;
    this.verticalName = 'pizzeria';
  }

  async ingestPizzeriaEvent({ type, payload, tenantId }) {
    return this.kernel.ingestEvent({
      type,
      payload: { ...payload, vertical: this.verticalName },
      tenantId,
    });
  }

  async generatePizzeriaDecisions({ tenantId, eventType, eventPayload }) {
    return this.kernel.decisionEngine.decide({
      tenantId,
      context: {
        vertical: this.verticalName,
        eventType,
        eventPayload,
      },
    });
  }

  async getPizzeriaOperationalState({ tenantId }) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });
    return {
      activeOrders: occState?.orders?.filter((o) => o.status !== 'delivered') || [],
      ovenStatus: this._projectOvenStatus(occState),
      deliveryFleet: this._projectDeliveryStatus(occState),
      kpis: this._calculateKpis(occState),
    };
  }

  _projectOvenStatus(occState) {
    return { utilization: 0, slots: [], status: 'idle' };
  }

  _projectDeliveryStatus(occState) {
    return { activeDrivers: 0, avgDeliveryTime: 0, routes: [] };
  }

  _calculateKpis(occState) {
    return PIZZERIA_KPI_SET;
  }
}

module.exports = {
  PizzeriaOperationsAdapter,
  PIZZERIA_EVENTS,
  PIZZERIA_DECISION_POLICIES,
  PIZZERIA_KPI_SET,
};

'use strict';

/**
 * Bakery Decision Policies
 * 
 * Define as regras de decisão que o motor operacional deve aplicar
 * em contexto de padaria.
 */

const BAKERY_DECISION_POLICIES = Object.freeze({
  // === Priority Rules ===
  orderPriority: {
    rules: [
      {
        condition: 'order.urgent && !order.delayed',
        priority: 'high',
        reason: 'urgent_non_delayed',
      },
      {
        condition: 'order.delayed && time_overdue > 15min',
        priority: 'critical',
        reason: 'severe_delay_risk',
      },
      {
        condition: 'order.preorder && delivery_date_approaching',
        priority: 'high',
        reason: 'approaching_deadline',
      },
      {
        condition: 'order.combo && demand_low',
        priority: 'medium',
        reason: 'combo_during_idle',
      },
      {
        condition: 'order.standard',
        priority: 'normal',
        reason: 'standard_order',
      },
    ],
  },

  // === Queue Management ===
  queueManagement: {
    rules: [
      {
        condition: 'queue_length > capacity * 0.8',
        decision: 'open_additional_counter',
        threshold: 0.8,
      },
      {
        condition: 'wait_time_predicted > 20min',
        decision: 'call_staff_alert',
        threshold: 20,
      },
      {
        condition: 'wait_time_predicted < 5min && queue_idle',
        decision: 'pause_customer_calls',
      },
    ],
  },

  // === Production Scheduling ===
  productionScheduling: {
    rules: [
      {
        condition: 'rush_window_detected',
        decision: 'accelerate_production',
        bufferTime: 30, // minutos antes do pico
      },
      {
        condition: 'oven_load > 80%',
        decision: 'defer_non_urgent_orders',
      },
      {
        condition: 'idle_window_detected',
        decision: 'trigger_quick_campaign',
        campaignWindow: 45, // minutos
      },
    ],
  },

  // === Pickup & Delay Management ===
  pickupManagement: {
    rules: [
      {
        condition: 'order.ready && !customer.called',
        decision: 'queue_announcement',
        delay: 0,
      },
      {
        condition: 'order.ready && time_held > 30min',
        decision: 'customer_notification',
        urgency: 'high',
        message: 'pickup_reminder',
      },
      {
        condition: 'order.ready && time_held > 60min',
        decision: 'escalate_to_support',
        urgency: 'critical',
      },
    ],
  },

  // === Customer Reactivation ===
  customerReactivation: {
    rules: [
      {
        condition: 'customer.recurring && last_purchase > 30days',
        decision: 'evaluate_reactivation',
        window: 30,
      },
      {
        condition: 'customer.recurring && last_purchase > 45days',
        decision: 'send_reactivation_campaign',
        incentive: 'loyalty_discount',
        window: 45,
      },
      {
        condition: 'customer.recurring && churn_risk_high',
        decision: 'priority_retention_outreach',
        priority: 'high',
      },
    ],
  },

  // === Campaign Timing ===
  campaignTiming: {
    rules: [
      {
        condition: 'idle_window && inventory_available',
        decision: 'quick_campaign',
        types: ['combo', 'special', 'bundle'],
        duration: 45,
      },
      {
        condition: 'rush_window_detected',
        decision: 'pause_campaigns',
        duration: 120, // minutos
      },
      {
        condition: 'time_in_quiet_hours',
        decision: 'suppress_notifications',
      },
    ],
  },

  // === Revenue Optimization ===
  revenueOptimization: {
    rules: [
      {
        condition: 'order.eligible_for_upsell && time_low_demand',
        decision: 'suggest_combo',
        priority: 'normal',
      },
      {
        condition: 'customer.high_lifetime_value',
        decision: 'preferential_service',
        priority: 'high',
      },
      {
        condition: 'cart_value < combo_threshold',
        decision: 'combo_suggestion',
        threshold: 'low_basket',
      },
    ],
  },
});

/**
 * Decision Workflow para Padaria
 * 
 * Cada evento passa por este workflow:
 */
const BAKERY_DECISION_WORKFLOW = [
  {
    step: 1,
    name: 'event_classification',
    description: 'Classificar tipo de evento (order, queue, demand, customer)',
  },
  {
    step: 2,
    name: 'priority_evaluation',
    description: 'Aplicar priority rules baseado no estado',
  },
  {
    step: 3,
    name: 'context_assessment',
    description: 'Avaliar contexto (rush, idle, capacity)',
  },
  {
    step: 4,
    name: 'decision_selection',
    description: 'Selecionar decision policy adequada',
  },
  {
    step: 5,
    name: 'action_execution',
    description: 'Executar action (playbook ou quick action)',
  },
  {
    step: 6,
    name: 'outcome_recording',
    description: 'Registrar outcome para learning',
  },
];

module.exports = {
  BAKERY_DECISION_POLICIES,
  BAKERY_DECISION_WORKFLOW,
};

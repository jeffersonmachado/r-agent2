'use strict';

/**
 * Bakery Operational Events
 * 
 * Define o vocabulário de eventos que a padaria utiliza.
 * Todos os eventos são integrados ao operational-events backbone.
 * 
 * Padrão: vertical:entity.action#context
 */

const BAKERY_EVENTS = Object.freeze({
  // === Order Lifecycle ===
  'bakery:order.created': {
    description: 'Pedido criado no sistema',
    subjects: ['order'],
    contexts: ['counter', 'phone', 'whatsapp', 'walk-in'],
    priority: 'high',
    triggers: ['queue_management', 'inventory_check'],
  },
  'bakery:order.confirmed': {
    description: 'Pedido confirmado e pago',
    subjects: ['order'],
    contexts: ['counter', 'phone', 'whatsapp'],
    priority: 'high',
    triggers: ['production_scheduling'],
  },
  'bakery:order.in_production': {
    description: 'Pedido entrou na produção',
    subjects: ['order', 'oven'],
    contexts: ['oven', 'counter'],
    priority: 'medium',
    triggers: ['queue_update', 'customer_notification'],
  },
  'bakery:order.ready_for_pickup': {
    description: 'Pedido pronto para retirada',
    subjects: ['order'],
    contexts: ['counter'],
    priority: 'high',
    triggers: ['queue_call', 'customer_notification', 'pickup_reminder'],
  },
  'bakery:order.pickup_delayed': {
    description: 'Cliente não retirou dentro do prazo',
    subjects: ['order'],
    contexts: ['counter'],
    priority: 'high',
    triggers: ['delay_mitigation', 'retention_campaign'],
  },
  'bakery:order.delivered': {
    description: 'Pedido foi entregue ao cliente',
    subjects: ['order'],
    contexts: ['counter', 'delivery'],
    priority: 'medium',
    triggers: ['revenue_posting', 'customer_satisfaction_survey'],
  },
  'bakery:order.cancelled': {
    description: 'Pedido foi cancelado',
    subjects: ['order'],
    contexts: ['counter', 'phone', 'whatsapp'],
    priority: 'high',
    triggers: ['inventory_release', 'retention_outreach'],
  },

  // === Queue & Pickup ===
  'bakery:queue.ticket_created': {
    description: 'Ticket de atendimento criado',
    subjects: ['queue', 'customer'],
    contexts: ['counter'],
    priority: 'high',
    triggers: ['wait_time_prediction'],
  },
  'bakery:queue.ticket_called': {
    description: 'Cliente chamado no balcão',
    subjects: ['queue'],
    contexts: ['counter'],
    priority: 'high',
    triggers: ['customer_notification'],
  },
  'bakery:pickup.scheduled': {
    description: 'Retirada agendada',
    subjects: ['order'],
    contexts: ['counter', 'phone', 'whatsapp'],
    priority: 'medium',
  },
  'bakery:pickup.confirmed': {
    description: 'Retirada confirmada pelo cliente',
    subjects: ['order'],
    contexts: ['auto'],
    priority: 'high',
    triggers: ['production_finalization'],
  },

  // === Pre-order & Encomenda ===
  'bakery:preorder.created': {
    description: 'Encomenda aberta',
    subjects: ['preorder'],
    contexts: ['counter', 'phone', 'whatsapp'],
    priority: 'high',
    triggers: ['production_planning', 'inventory_reserve'],
  },
  'bakery:preorder.confirmed': {
    description: 'Encomenda confirmada e paga',
    subjects: ['preorder'],
    contexts: ['auto'],
    priority: 'high',
    triggers: ['production_scheduling'],
  },
  'bakery:preorder.ready': {
    description: 'Encomenda pronta',
    subjects: ['preorder'],
    contexts: ['auto'],
    priority: 'high',
    triggers: ['customer_notification', 'pickup_reminder'],
  },
  'bakery:preorder.delivered': {
    description: 'Encomenda entregue',
    subjects: ['preorder'],
    contexts: ['auto'],
    priority: 'medium',
    triggers: ['revenue_posting', 'reorder_campaign'],
  },

  // === Oven & Production ===
  'bakery:oven.capacity_available': {
    description: 'Forno tem disponibilidade',
    subjects: ['oven'],
    contexts: ['production'],
    priority: 'high',
    triggers: ['production_dispatch'],
  },
  'bakery:oven.overload_risk': {
    description: 'Risco de sobrecarga no forno',
    subjects: ['oven'],
    contexts: ['production'],
    priority: 'high',
    triggers: ['production_realing', 'delay_mitigation'],
  },

  // === Demand & Rush Windows ===
  'bakery:rush_window.detected': {
    description: 'Janela de pico detectada (horário de alta demanda)',
    subjects: ['demand'],
    contexts: ['analytics'],
    priority: 'high',
    triggers: ['staffing_alert', 'production_prep', 'campaign_pause'],
  },
  'bakery:idle_window.detected': {
    description: 'Janela ociosa detectada',
    subjects: ['demand'],
    contexts: ['analytics'],
    priority: 'medium',
    triggers: ['quick_campaign', 'combo_promo'],
  },

  // === Customer Lifecycle ===
  'bakery:customer.recurring.risk': {
    description: 'Cliente recorrente em risco de inatividade',
    subjects: ['customer'],
    contexts: ['analytics'],
    priority: 'high',
    triggers: ['retention_campaign', 'loyalty_check'],
  },
  'bakery:customer.reactivation_due': {
    description: 'Cliente inativo elegível para reativação',
    subjects: ['customer'],
    contexts: ['analytics'],
    priority: 'medium',
    triggers: ['reactivation_campaign', 'incentive_offer'],
  },
  'bakery:customer.combo_eligible': {
    description: 'Cliente elegível para combo',
    subjects: ['customer', 'order'],
    contexts: ['auto'],
    priority: 'low',
    triggers: ['combo_suggestion', 'upsell_campaign'],
  },

  // === Inventory & Stock ===
  'bakery:inventory.low_stock': {
    description: 'Nível baixo de estoque',
    subjects: ['product'],
    contexts: ['inventory'],
    priority: 'high',
    triggers: ['reorder_alert', 'availability_warning'],
  },
  'bakery:inventory.out_of_stock': {
    description: 'Produto fora de estoque',
    subjects: ['product'],
    contexts: ['inventory'],
    priority: 'high',
    triggers: ['unavailability_notification', 'substitute_suggestion'],
  },

  // === Campaign & Marketing ===
  'bakery:campaign.quick.triggered': {
    description: 'Campanha rápida disparada (ex: combo, combo durante ociosidade)',
    subjects: ['campaign'],
    contexts: ['marketing'],
    priority: 'medium',
    triggers: ['customer_notification', 'campaign_tracking'],
  },
  'bakery:campaign.quick.response': {
    description: 'Cliente respondeu a campanha rápida',
    subjects: ['customer', 'campaign'],
    contexts: ['auto'],
    priority: 'medium',
    triggers: ['order_conversion', 'campaign_success'],
  },
});

module.exports = {
  BAKERY_EVENTS,
};

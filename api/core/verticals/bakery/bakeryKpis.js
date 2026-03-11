'use strict';

/**
 * Bakery KPIs (Key Performance Indicators)
 * 
 * Define os indicadores de desempenho específicos da padaria.
 * Utilizados para:
 * - Monitoramento em tempo real
 * - Alertas operacionais
 * - Decisões autônomas
 * - Relatórios executivos
 */

const BAKERY_KPI_SET = Object.freeze({
  // === REVENUE KPIS ===
  revenue: {
    ticket_medio: {
      name: 'Ticket Médio',
      unit: 'BRL',
      calculation: 'total_revenue / total_orders',
      target: 45,
      alert_threshold: { low: 35, high: 60 },
      frequency: 'hourly',
      period: '7d',
    },
    revenue_hourly: {
      name: 'Receita por Hora',
      unit: 'BRL',
      calculation: 'sum(order.value) per hour',
      target: 500,
      frequency: 'real-time',
      period: '24h',
    },
    revenue_by_period: {
      name: 'Receita por Período (rush vs idle)',
      unit: 'BRL',
      calculation: 'revenue split by demand_window',
      target: 'rush:idle ratio 3:1',
      frequency: 'hourly',
      period: '7d',
    },
    upsell_rate: {
      name: 'Taxa de Upsell (combos)',
      unit: '%',
      calculation: '(orders_with_upsell / total_orders) * 100',
      target: 20,
      frequency: 'daily',
      period: '7d',
    },
  },

  // === OPERATIONAL KPIS ===
  operational: {
    queue_wait_time: {
      name: 'Tempo de Espera em Fila',
      unit: 'min',
      calculation: 'average(time_from_entry_to_service)',
      target: 8,
      alert_threshold: { warning: 12, critical: 15 },
      frequency: 'real-time',
      period: '24h',
    },
    pickup_time: {
      name: 'Tempo de Retirada (após pronto)',
      unit: 'min',
      calculation: 'average(time_from_ready_to_collected)',
      target: 15,
      alert_threshold: { warning: 25, critical: 40 },
      frequency: 'hourly',
      period: '7d',
    },
    production_time: {
      name: 'Tempo de Produção',
      unit: 'min',
      calculation: 'average(time_from_confirmed_to_ready)',
      target: 25,
      alert_threshold: { warning: 35, critical: 50 },
      frequency: 'hourly',
      period: '24h',
    },
    oven_utilization: {
      name: 'Taxa de Utilização do Forno',
      unit: '%',
      calculation: '(time_used / time_available) * 100',
      target: 75,
      alert_threshold: { low: 50, high: 95 },
      frequency: 'real-time',
      period: '24h',
    },
    order_fulfillment_rate: {
      name: 'Taxa de Fulfillment (% entregue no prazo)',
      unit: '%',
      calculation: '(orders_on_time / total_orders) * 100',
      target: 95,
      alert_threshold: { low: 85 },
      frequency: 'daily',
      period: '7d',
    },
  },

  // === CUSTOMER KPIS ===
  customer: {
    recurring_rate: {
      name: 'Taxa de Cliente Recorrente',
      unit: '%',
      calculation: '(customers_repeat_purchase / total_customers) * 100',
      target: 40,
      frequency: 'weekly',
      period: '30d',
    },
    customer_retention: {
      name: 'Taxa de Retenção',
      unit: '%',
      calculation: '((end_customers - new_customers) / start_customers) * 100',
      target: 85,
      frequency: 'weekly',
      period: '30d',
    },
    customer_churn_risk: {
      name: 'Taxa de Risco de Churn (clientes recorrentes inativos)',
      unit: '%',
      calculation: '(customers_inactive_30d / customers_recurring) * 100',
      target: 15,
      alert_threshold: { warning: 20, critical: 25 },
      frequency: 'daily',
      period: '30d',
    },
    reactivation_success: {
      name: 'Taxa de Sucesso de Reativação',
      unit: '%',
      calculation: '(reactivated_customers_purchased / invited_customers) * 100',
      target: 25,
      frequency: 'weekly',
      period: '30d',
    },
    nps: {
      name: 'Net Promoter Score',
      unit: 'score',
      calculation: '%promoters - %detractors',
      target: 40,
      frequency: 'monthly',
      period: '30d',
    },
  },

  // === INVENTORY KPIS ===
  inventory: {
    stock_out_incidents: {
      name: 'Incidentes de Falta de Estoque',
      unit: 'count',
      calculation: 'number of stockout events per day',
      target: 0,
      alert_threshold: { warning: 1, critical: 3 },
      frequency: 'daily',
      period: '7d',
    },
    inventory_turnover: {
      name: 'Giro de Estoque',
      unit: 'turns/month',
      calculation: 'cost_of_goods_sold / average_inventory',
      target: 8,
      frequency: 'weekly',
      period: '30d',
    },
    waste_rate: {
      name: 'Taxa de Perda/Descarte',
      unit: '%',
      calculation: '(discarded_items / produced_items) * 100',
      target: 5,
      frequency: 'daily',
      period: '7d',
    },
  },

  // === DEMAND KPIS ===
  demand: {
    rush_window_orders: {
      name: 'Pedidos em Janela de Pico',
      unit: '%',
      calculation: '(orders_in_rush / total_orders) * 100',
      target: 45,
      frequency: 'daily',
      period: '7d',
    },
    idle_window_penetration: {
      name: 'Penetração em Janela Ociosa (% de pedidos)',
      unit: '%',
      calculation: '(orders_in_idle / total_orders) * 100',
      target: 15,
      frequency: 'daily',
      period: '7d',
    },
    campaign_response_rate: {
      name: 'Taxa de Resposta a Campanhas Rápidas',
      unit: '%',
      calculation: '(campaign_conversions / campaign_invites) * 100',
      target: 5,
      frequency: 'daily',
      period: '7d',
    },
  },
});

/**
 * KPI Definitions for Alerting & Automations
 * 
 * Sistema deve dispara alertas e acionamentos automáticos baseado
 * em thresholds de KPIs.
 */
const BAKERY_KPI_AUTOMATIONS = [
  {
    kpi: 'queue_wait_time',
    trigger: 'threshold_exceeded',
    threshold: { warning: 12, critical: 15 },
    actions: [
      {
        level: 'warning',
        action: 'notify_manager',
        message: 'Fila com espera acima do esperado',
      },
      {
        level: 'critical',
        action: 'call_staff',
        message: 'FILA CRÍTICA - Chamar colaborador adicional',
      },
    ],
  },
  {
    kpi: 'pickup_time',
    trigger: 'threshold_exceeded',
    threshold: { warning: 25, critical: 40 },
    actions: [
      {
        level: 'warning',
        action: 'send_reminder',
        message: 'Pedido esperando retirada há {minutes}min',
      },
      {
        level: 'critical',
        action: 'escalate_support',
        message: 'Pedido não retirado há {minutes}min',
      },
    ],
  },
  {
    kpi: 'oven_utilization',
    trigger: 'threshold_exceeded',
    threshold: { high: 95 },
    actions: [
      {
        level: 'warning',
        action: 'defer_production',
        message: 'Forno está no limite - diferir pedidos não urgentes',
      },
    ],
  },
  {
    kpi: 'stock_out_incidents',
    trigger: 'value_increased',
    threshold: 1,
    actions: [
      {
        level: 'critical',
        action: 'alert_manager',
        message: 'Falta de estoque detectada',
      },
    ],
  },
];

module.exports = {
  BAKERY_KPI_SET,
  BAKERY_KPI_AUTOMATIONS,
};

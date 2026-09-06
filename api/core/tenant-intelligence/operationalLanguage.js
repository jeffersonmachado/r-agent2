'use strict';

/**
 * Linguagem outcome-first da camada de inteligência.
 *
 * Identificadores técnicos (metric keys, event types) são traduzidos para
 * linguagem de negócio PT-BR nas superfícies humanas (títulos e descrições
 * de insights, causas prováveis, recomendações). Campos de máquina
 * (relatedMetrics, metadata, evidências) mantêm as chaves brutas para
 * rastreabilidade — só a linguagem exibida muda.
 *
 * Os mapas cobrem as chaves realmente emitidas pelo MetricEngine e os
 * tipos presentes no event_ledger; chaves desconhecidas caem num fallback
 * humanizado (nunca no identificador cru).
 */

const METRIC_LABELS = {
  attendance_rate: 'taxa de comparecimento',
  cancellation_rate: 'taxa de cancelamento',
  conversion_rate: 'taxa de conversão',
  no_show_rate: 'taxa de não comparecimento (no-show)',
  'operations.tickets_total': 'atendimentos no período',
  'operations.tickets_open': 'atendimentos em aberto',
  'operations.avg_first_response_minutes': 'tempo médio de primeira resposta',
  'operations.avg_resolution_minutes': 'tempo médio de resolução',
  'operations.abandonment_rate_pct': 'taxa de abandono',
  'operations.bot_containment_rate_pct': 'taxa de resolução pelo assistente',
  'event_ledger.total_events': 'eventos operacionais registrados',
  'event_ledger.recent_events': 'eventos operacionais recentes',
  'event_ledger.dispatch.pending': 'ações automáticas pendentes',
  'event_ledger.dispatch.dead': 'ações automáticas com falha definitiva',
  'event_ledger.dispatch.done_recent': 'ações automáticas concluídas',
  'event_ledger.top_type_ratio': 'concentração do padrão dominante de eventos',
};

const EVENT_TYPE_LABELS = {
  ScheduledTriggerFired: 'rotinas automáticas programadas',
  VerticalJourney_Custom: 'etapas da jornada do cliente',
  DeliverySLARisk: 'riscos de atraso na entrega',
  DeliveryCreated: 'entregas criadas',
  DeliveryStatusChanged: 'mudanças de status de entregas',
  VoiceFlowAction: 'interações do atendimento por voz',
  VoiceFlowInput: 'interações do atendimento por voz',
  VoiceRecordingCaptured: 'gravações de chamadas',
  VoiceCallRinging: 'chamadas de voz recebidas',
  VoiceCallAnswered: 'chamadas de voz atendidas',
  VoiceCallEnded: 'chamadas de voz encerradas',
  VoiceCallTransfer: 'transferências de chamadas',
  VoiceCallDtmf: 'interações por teclado na chamada',
  CallRinging: 'chamadas recebidas',
  CallAnswered: 'chamadas atendidas',
  CallEnded: 'chamadas encerradas',
  OrderCreated: 'pedidos criados',
  OrderStatusChanged: 'mudanças de status de pedidos',
  MembershipBillingStatusChanged: 'mudanças na cobrança de assinaturas',
  PbxCdrIngested: 'registros de chamadas telefônicas',
  FitnessCheckIn: 'check-ins na academia',
  LoyaltyPointsGranted: 'pontos de fidelidade concedidos',
  SessionBundleConsumed: 'sessões de pacotes utilizadas',
  PhysicalTicketCalled: 'senhas presenciais chamadas',
  PhysicalTicketCreated: 'senhas presenciais emitidas',
};

function humanizeIdentifier(value) {
  // PascalCase/camelCase/snake_case/dotted → palavras legíveis minúsculas.
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function metricLabel(metricKey) {
  const key = String(metricKey || '');
  if (!key) return 'indicador operacional';
  return METRIC_LABELS[key] || humanizeIdentifier(key) || 'indicador operacional';
}

function eventTypeLabel(eventType) {
  const type = String(eventType || '');
  if (!type || type === 'unknown') return 'eventos operacionais';
  return EVENT_TYPE_LABELS[type] || humanizeIdentifier(type) || 'eventos operacionais';
}

module.exports = {
  METRIC_LABELS,
  EVENT_TYPE_LABELS,
  metricLabel,
  eventTypeLabel,
  humanizeIdentifier,
};

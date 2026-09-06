'use strict';

/**
 * Linguagem outcome-first: identificadores técnicos nunca aparecem crus
 * nas superfícies humanas (insights, causas, recomendações).
 */

const {
  metricLabel,
  eventTypeLabel,
  humanizeIdentifier,
} = require('../../api/core/tenant-intelligence/operationalLanguage');

describe('operationalLanguage.metricLabel', () => {
  test.each([
    ['conversion_rate', 'taxa de conversão'],
    ['no_show_rate', 'taxa de não comparecimento (no-show)'],
    ['operations.tickets_open', 'atendimentos em aberto'],
    ['operations.avg_first_response_minutes', 'tempo médio de primeira resposta'],
    ['operations.abandonment_rate_pct', 'taxa de abandono'],
    ['event_ledger.total_events', 'eventos operacionais registrados'],
    ['event_ledger.dispatch.dead', 'ações automáticas com falha definitiva'],
  ])('chave conhecida %s vira rótulo de negócio', (key, expected) => {
    expect(metricLabel(key)).toBe(expected);
  });

  test('chave desconhecida é humanizada, nunca retorna crua', () => {
    const label = metricLabel('operations.tickets_closed');
    expect(label).toBe('operations tickets closed');
    expect(label).not.toContain('_');
    expect(label).not.toContain('.');
  });

  test('vazio/null cai em rótulo genérico', () => {
    expect(metricLabel('')).toBe('indicador operacional');
    expect(metricLabel(null)).toBe('indicador operacional');
  });
});

describe('operationalLanguage.eventTypeLabel', () => {
  test.each([
    ['ScheduledTriggerFired', 'rotinas automáticas programadas'],
    ['OrderCreated', 'pedidos criados'],
    ['FitnessCheckIn', 'check-ins na academia'],
    ['CallAnswered', 'chamadas atendidas'],
    ['DeliverySLARisk', 'riscos de atraso na entrega'],
  ])('tipo conhecido %s vira rótulo de negócio', (type, expected) => {
    expect(eventTypeLabel(type)).toBe(expected);
  });

  test('tipo desconhecido é humanizado sem CamelCase cru', () => {
    const label = eventTypeLabel('CustomWorkflowExecuted');
    expect(label).toBe('custom workflow executed');
    expect(label).not.toMatch(/[A-Z]/);
  });

  test('unknown/vazio cai em rótulo genérico', () => {
    expect(eventTypeLabel('unknown')).toBe('eventos operacionais');
    expect(eventTypeLabel('')).toBe('eventos operacionais');
  });
});

describe('operationalLanguage.humanizeIdentifier', () => {
  test('converte os formatos comuns de identificador', () => {
    expect(humanizeIdentifier('ScheduledTriggerFired')).toBe('scheduled trigger fired');
    expect(humanizeIdentifier('event_ledger.total_events')).toBe('event ledger total events');
    expect(humanizeIdentifier('avg-first-response')).toBe('avg first response');
  });
});

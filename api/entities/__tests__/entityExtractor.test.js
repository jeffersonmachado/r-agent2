'use strict';

const { extractEntitiesFromText } = require('../entityExtractor');

describe('entityExtractor', () => {
  test('extrai entidades básicas de texto', () => {
    const text = 'Meu email joao@acme.com, pedido #AB1234, erro HTTP 500, valor R$ 199,90 às 14:30';
    const result = extractEntitiesFromText(text, { tenant_id: 't1', channel: 'whatsapp' });

    expect(result.entities.email.value).toBe('joao@acme.com');
    expect(result.entities.order_id.value).toBe('ab1234');
    expect(result.entities.http_status.value).toBe(500);
    expect(result.entities.money.value).toContain('R$');
    expect(result.entities.time.value).toBe('14:30');
  });

  test('retorna warning para texto vazio', () => {
    const result = extractEntitiesFromText('   ', { tenant_id: 't1', channel: 'web' });
    expect(result.warnings).toContain('empty_text');
    expect(result.entities).toEqual({});
  });

  test('aceita tenantKeywords para product_or_plan', () => {
    const result = extractEntitiesFromText('Quero fazer upgrade do pacote atual', {
      tenant_id: 't1',
      channel: 'web',
      tenantKeywords: ['upgrade', 'pacote'],
    });

    const values = Array.isArray(result.entities.product_or_plan)
      ? result.entities.product_or_plan.map((entry) => entry.value)
      : [result.entities.product_or_plan?.value].filter(Boolean);

    expect(values).toEqual(expect.arrayContaining(['upgrade', 'pacote']));
  });

  test('não gera product_or_plan por substring parcial', () => {
    const result = extractEntitiesFromText('A palavra profile não deve gerar plano automaticamente', {
      tenant_id: 't1',
      channel: 'web',
    });

    const values = Array.isArray(result.entities.product_or_plan)
      ? result.entities.product_or_plan.map((entry) => entry.value)
      : [result.entities.product_or_plan?.value].filter(Boolean);

    expect(values).not.toContain('pro');
  });

  test('keywords explícitas têm precedência sobre tenantKeywords', () => {
    const result = extractEntitiesFromText('quero downgrade do pacote', {
      tenant_id: 't1',
      channel: 'web',
      keywords: ['downgrade'],
      tenantKeywords: ['pacote'],
    });

    const values = Array.isArray(result.entities.product_or_plan)
      ? result.entities.product_or_plan.map((entry) => entry.value)
      : [result.entities.product_or_plan?.value].filter(Boolean);

    expect(values).toContain('downgrade');
    expect(values).not.toContain('pacote');
  });
});

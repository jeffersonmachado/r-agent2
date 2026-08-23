'use strict';

const { evaluateIntegrationReadiness } = require('../../api/modules/config/service');

function baseConfig(overrides = {}) {
  return {
    billing: {
      provider: 'asaas',
      providers: {
        asaas: {
          baseUrl: 'https://api.asaas.com/v3',
          apiKey: 'chave-real-123',
          webhookSecret: 'segredo-webhook',
        },
      },
    },
    notifications: {
      whatsapp: { enabled: false },
      sms: { enabled: false },
      email: { enabled: false },
    },
    ...overrides,
  };
}

describe('evaluateIntegrationReadiness — billing.provider', () => {
  test('aceita provider sandbox sem exigir credenciais', () => {
    const result = evaluateIntegrationReadiness(baseConfig({ billing: { provider: 'sandbox' } }));
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('aceita provider mock como alias de sandbox', () => {
    const result = evaluateIntegrationReadiness(baseConfig({ billing: { provider: 'mock' } }));
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('aceita provider asaas completo', () => {
    const result = evaluateIntegrationReadiness(baseConfig());
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('exige campos do Asaas quando provider é asaas', () => {
    const result = evaluateIntegrationReadiness(baseConfig({
      billing: {
        provider: 'asaas',
        providers: { asaas: { baseUrl: 'https://api.asaas.com/v3' } },
      },
    }));
    expect(result.ready).toBe(false);
    expect(result.missing.map((m) => m.path)).toEqual([
      'billing.providers.asaas.apiKey',
      'billing.providers.asaas.webhookSecret',
    ]);
  });

  test('exige campos do Mercado Pago quando provider é mercado_pago', () => {
    const result = evaluateIntegrationReadiness(baseConfig({
      billing: { provider: 'mercado_pago', providers: {} },
    }));
    expect(result.ready).toBe(false);
    expect(result.missing.map((m) => m.path)).toEqual([
      'billing.providers.mercadoPago.baseUrl',
      'billing.providers.mercadoPago.accessToken',
      'billing.providers.mercadoPago.webhookSecret',
    ]);
  });

  test('rejeita provider desconhecido', () => {
    const result = evaluateIntegrationReadiness(baseConfig({ billing: { provider: 'paypal' } }));
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      { path: 'billing.provider', reason: 'Provider inválido: paypal' },
    ]);
  });

  test('exige provider quando ausente', () => {
    const result = evaluateIntegrationReadiness(baseConfig({ billing: {} }));
    expect(result.ready).toBe(false);
    expect(result.missing[0].path).toBe('billing.provider');
  });
});

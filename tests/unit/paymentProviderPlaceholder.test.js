'use strict';

/**
 * Regressão (2026-08-12): o provider de pagamento aceitava placeholders
 * (ex.: "REPLACE_WITH_ASAAS_API_KEY") como credencial válida e só falhava na
 * chamada HTTP real (401 do provider), virando 500 genérico para o usuário.
 *
 * Agora `requireConfig` trata placeholders como "não configurado" e lança
 * `required_config_missing` ANTES de qualquer chamada HTTP.
 */

jest.mock('../../api/utils/config');
jest.mock('../../api/utils/logger');

const config = require('../../api/utils/config');
const paymentProvider = require('../../api/integrations/paymentProvider');

function setFileValues(overrides = {}) {
  const values = {
    'billing.provider': 'asaas',
    'billing.providers.asaas.baseUrl': 'https://api.asaas.com/v3',
    'billing.providers.asaas.apiKey': 'REPLACE_WITH_ASAAS_API_KEY',
    'billing.providers.asaas.webhookSecret': 'segredo-webhook',
    'billing.providers.mercadoPago.baseUrl': 'https://api.mercadopago.com',
    'billing.providers.mercadoPago.accessToken': 'REPLACE_WITH_MP_ACCESS_TOKEN',
    'billing.providers.mercadoPago.webhookSecret': 'segredo-mp',
    ...overrides,
  };
  config.getFromFile.mockImplementation((path, defaultValue) => (
    Object.prototype.hasOwnProperty.call(values, path) ? values[path] : defaultValue
  ));
  config.get.mockImplementation((key, defaultValue) => (
    key === 'nodeEnv' ? 'development' : defaultValue
  ));
}

beforeEach(() => {
  setFileValues();
});

describe('paymentProvider detecção de placeholders', () => {
  test('asaas com apiKey placeholder lança required_config_missing (sem HTTP)', async () => {
    await expect(paymentProvider.createCustomer({
      provider: 'asaas',
      tenantId: 'system',
      customer: { name: 'Ana' },
    })).rejects.toMatchObject({ code: 'required_config_missing' });
  });

  test('mercado_pago com accessToken placeholder lança required_config_missing', async () => {
    await expect(paymentProvider.createCustomer({
      provider: 'mercado_pago',
      tenantId: 'system',
      customer: { name: 'Ana' },
    })).rejects.toMatchObject({ code: 'required_config_missing' });
  });

  test('chave real não é tratada como placeholder', async () => {
    setFileValues({
      'billing.providers.asaas.apiKey': 'chave-real-valida-123',
    });
    // Com chave real, a chamada tenta HTTP (fetch) e falha por outro motivo;
    // o importante é NÃO ser required_config_missing.
    await expect(paymentProvider.createCustomer({
      provider: 'asaas',
      tenantId: 'system',
      customer: { name: 'Ana' },
    })).rejects.not.toMatchObject({ code: 'required_config_missing' });
  });

  test('sandbox continua funcionando sem chave real', async () => {
    const out = await paymentProvider.createCustomer({
      provider: 'sandbox',
      tenantId: 'system',
      customer: { name: 'Ana' },
    });
    expect(out.raw.sandbox).toBe(true);
  });

  test('chave real contendo "xxx"/"example" no meio NÃO é placeholder', async () => {
    setFileValues({
      // A heurística é ancorada no início: substrings no meio de uma chave
      // aleatória real não podem marcá-la como placeholder.
      'billing.providers.asaas.apiKey': '$aact_prod_xXx9f2examplekey7d1',
    });
    await expect(paymentProvider.createCustomer({
      provider: 'asaas',
      tenantId: 'system',
      customer: { name: 'Ana' },
    })).rejects.not.toMatchObject({ code: 'required_config_missing' });
  });

  test('placeholders ancorados no início continuam bloqueados', async () => {
    for (const fake of ['SEU_TOKEN_AQUI', 'your-api-key', 'example_key_123', 'changeme', 'XXXXX']) {
      setFileValues({ 'billing.providers.asaas.apiKey': fake });
      await expect(paymentProvider.createCustomer({
        provider: 'asaas',
        tenantId: 'system',
        customer: { name: 'Ana' },
      })).rejects.toMatchObject({ code: 'required_config_missing' });
    }
  });
});

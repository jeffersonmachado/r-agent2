'use strict';

/**
 * Regressão de segurança (auditoria 2026-08-03): paymentProvider.verifyWebhookSignature
 * tinha dois problemas no webhook de billing:
 * 1. `if (!cfg.webhookSecret) return true` — fail-open: sem secret configurado,
 *    qualquer payload forjado confirmava pagamentos (processWebhook atualiza
 *    BillingTransaction). Agora: fail-open APENAS fora de produção; em produção
 *    retorna false (rejeitado como invalid_webhook_signature pelo billingService).
 * 2. `token === cfg.webhookSecret` não era timing-safe. Agora a comparação usa
 *    crypto.timingSafeEqual com guard de length.
 * Comportamento PROVIDER_SANDBOX (sempre aceito) é preservado.
 */

jest.mock('../../api/utils/config');
jest.mock('../../api/utils/logger');

const config = require('../../api/utils/config');
const paymentProvider = require('../../api/integrations/paymentProvider');

// jest.config.cjs usa resetMocks:true — implementações definidas em beforeEach.
let fileValues;
let configValues;

beforeEach(() => {
  fileValues = {
    'billing.providers.asaas.baseUrl': 'https://asaas.example',
    'billing.providers.asaas.apiKey': 'asaas-key',
    'billing.providers.asaas.webhookSecret': 'segredo-webhook',
    'billing.providers.mercadoPago.baseUrl': 'https://mp.example',
    'billing.providers.mercadoPago.accessToken': 'mp-token',
    'billing.providers.mercadoPago.webhookSecret': 'segredo-mp',
  };
  configValues = { nodeEnv: 'development' };
  config.getFromFile.mockImplementation((path, defaultValue) => (
    Object.prototype.hasOwnProperty.call(fileValues, path) ? fileValues[path] : defaultValue
  ));
  config.get.mockImplementation((key, defaultValue) => (
    Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : defaultValue
  ));
});

describe('paymentProvider.verifyWebhookSignature', () => {
  test('token correto é aceito (x-webhook-token)', () => {
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: { 'x-webhook-token': 'segredo-webhook' },
    })).toBe(true);
  });

  test('token correto é aceito via header alternativo x-signature', () => {
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'mercado_pago',
      headers: { 'x-signature': 'segredo-mp' },
    })).toBe(true);
  });

  test('token errado é rejeitado', () => {
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: { 'x-webhook-token': 'segredo-webhooX' },
    })).toBe(false);
  });

  test('token com tamanho diferente é rejeitado (guard de length)', () => {
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: { 'x-webhook-token': 'curto' },
    })).toBe(false);
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: { 'x-webhook-token': 'segredo-webhook-com-cauda-bem-maior' },
    })).toBe(false);
  });

  test('header ausente é rejeitado', () => {
    expect(paymentProvider.verifyWebhookSignature({ provider: 'asaas', headers: {} })).toBe(false);
  });

  test('secret ausente em produção é rejeitado (fail-closed)', () => {
    fileValues['billing.providers.asaas.webhookSecret'] = '';
    configValues.nodeEnv = 'production';
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: { 'x-webhook-token': 'qualquer' },
    })).toBe(false);
  });

  test('secret ausente fora de produção é aceito (fail-open para dev local)', () => {
    fileValues['billing.providers.asaas.webhookSecret'] = '';
    configValues.nodeEnv = 'development';
    expect(paymentProvider.verifyWebhookSignature({
      provider: 'asaas',
      headers: {},
    })).toBe(true);
  });

  test('sandbox é sempre aceito (provider de teste)', () => {
    expect(paymentProvider.verifyWebhookSignature({ provider: 'sandbox', headers: {} })).toBe(true);
  });
});

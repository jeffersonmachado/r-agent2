'use strict';

/**
 * Persistência do resultado da consulta de saldo na credencial do tenant
 * (`tenantAIService.recordCredentialTestResult`) e leitura pela UI
 * (`getCredentialDetailsMap`).
 *
 * Dois defeitos reais que esta suíte fixa:
 *  1. só a DeepSeek era consultada, e os demais providers não gravavam NADA — a UI não tinha como
 *     distinguir "provider não expõe saldo" de "nunca foi testado";
 *  2. um saldo antigo permanecia gravado depois de um teste que não trouxe saldo, sendo exibido
 *     como se fosse o valor atual.
 */

const mockCredentialFindOne = jest.fn();
const mockCredentialFindAll = jest.fn();
const mockFindTenant = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
  connect: jest.fn(async () => ({})),
}));
jest.mock('../../api/db/models', () => ({
  Tenant: () => ({}),
  TenantAISetting: () => ({ findOne: jest.fn(), create: jest.fn() }),
  TenantAICredential: () => ({
    findOne: (...a) => mockCredentialFindOne(...a),
    findAll: (...a) => mockCredentialFindAll(...a),
    create: jest.fn(),
  }),
}));
jest.mock('../../api/services/tenantService', () => ({
  findTenantByIdentifier: (...a) => mockFindTenant(...a),
}));
jest.mock('../../api/utils/crypto', () => ({
  encrypt: jest.fn((v) => `enc:${v}`),
  decrypt: jest.fn((v) => v),
}));
jest.mock('../../api/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { recordCredentialTestResult, getCredentialDetailsMap } = require('../../api/services/tenantAIService');

describe('persistência do saldo por credencial', () => {
  beforeEach(() => {
    mockFindTenant.mockResolvedValue({ id: 'uuid-system', tenant_key: 'system' });
    mockCredentialFindOne.mockReset();
    mockCredentialFindAll.mockReset();
  });

  it('grava o resultado da consulta mesmo quando o provider não expõe saldo', async () => {
    const update = jest.fn(async () => ({}));
    mockCredentialFindOne.mockResolvedValue({ metadata: {}, update });

    const ok = await recordCredentialTestResult('system', 'groq', {
      status: 'valid',
      lastError: null,
      balance: {
        provider: 'groq',
        status: 'not_supported',
        amount: null,
        currency: null,
        note: 'A Groq não possui endpoint de saldo/créditos na API pública — o probe respondeu 404.',
      },
    });

    expect(ok).toBe(true);
    const [payload] = update.mock.calls[0];
    expect(payload.status).toBe('valid');
    expect(payload.metadata.balance.status).toBe('not_supported');
    expect(payload.metadata.balance.note).toMatch(/404/);
    expect(typeof payload.metadata.balance.checkedAt).toBe('string');
    // Nunca inventa valor: ausência de saldo continua sendo null, não 0.
    expect(payload.metadata.balance.amount).toBeNull();
  });

  it('remove saldo antigo quando o teste não trouxe resultado de saldo', async () => {
    const update = jest.fn(async () => ({}));
    mockCredentialFindOne.mockResolvedValue({
      metadata: { balance: { amount: 99.9, currency: 'USD', checkedAt: '2026-09-01T00:00:00.000Z' }, outro: 'preservado' },
      update,
    });

    await recordCredentialTestResult('system', 'deepseek', {
      status: 'invalid_token',
      lastError: 'Token inválido ou expirado',
      balance: null,
    });

    const [payload] = update.mock.calls[0];
    expect(payload.metadata.balance).toBeUndefined();
    // Metadados não relacionados são preservados.
    expect(payload.metadata.outro).toBe('preservado');
  });

  it('não atualiza nada quando a credencial não está salva', async () => {
    mockCredentialFindOne.mockResolvedValue(null);

    const ok = await recordCredentialTestResult('system', 'deepseek', { status: 'valid' });

    expect(ok).toBe(false);
  });

  it('getCredentialDetailsMap expõe o resultado da consulta para a UI', async () => {
    mockCredentialFindAll.mockResolvedValue([
      {
        provider: 'kimi',
        status: 'valid',
        last_tested_at: new Date('2026-09-29T21:57:00.000Z'),
        last_error: null,
        metadata: { balance: { status: 'available', amount: 24.771458, currency: 'USD', checkedAt: '2026-09-29T21:57:00.000Z' } },
      },
      {
        provider: 'qwen',
        status: 'valid',
        last_tested_at: new Date('2026-09-29T21:57:00.000Z'),
        last_error: null,
        metadata: { balance: { status: 'not_supported', amount: null, currency: null, note: '404' } },
      },
    ]);

    const details = await getCredentialDetailsMap('system');

    expect(details.kimi.balance).toMatchObject({ status: 'available', amount: 24.771458, currency: 'USD' });
    expect(details.qwen.balance).toMatchObject({ status: 'not_supported', note: '404' });
    expect(details.groq.hasCredential).toBe(false);
  });
});

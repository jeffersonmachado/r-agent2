/**
 * Testes do timeout explícito na chamada de IA (erro code='ai_timeout')
 * e da memoização do provider resolvido por tenant.
 */

jest.mock('../../api/utils/config', () => ({
  get: jest.fn(() => false),
}));

const {
  registerAiProvider,
  setTenantAiConfig,
  getAiProviderForTenant,
  clearAiProviderConfig,
} = require('../aiProviderManager');

const ORIGINAL_ENV = process.env.ENGINE_AI_TIMEOUT_MS;

describe('aiProviderManager - timeout de IA', () => {
  beforeEach(() => {
    clearAiProviderConfig();
    process.env.ENGINE_AI_TIMEOUT_MS = '50';
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ENGINE_AI_TIMEOUT_MS;
    } else {
      process.env.ENGINE_AI_TIMEOUT_MS = ORIGINAL_ENV;
    }
  });

  test('provider pendurado falha com ai_timeout em vez de pendurar a mensagem', async () => {
    const hanging = {
      generate: jest.fn(() => new Promise(() => {})), // nunca resolve
    };
    registerAiProvider('openai', hanging);
    setTenantAiConfig('tenant-1', { primary: 'openai' });

    const provider = getAiProviderForTenant('tenant-1');
    expect(provider).not.toBeNull();

    await expect(provider.generate('hi', {})).rejects.toMatchObject({
      code: 'ai_timeout',
    });
  });

  test('provider que responde dentro do prazo retorna normalmente', async () => {
    const fast = {
      generate: jest.fn(async () => 'resposta'),
    };
    registerAiProvider('openai', fast);
    setTenantAiConfig('tenant-1', { primary: 'openai' });

    const provider = getAiProviderForTenant('tenant-1');
    await expect(provider.generate('hi', {})).resolves.toBe('resposta');
  });

  test('primário pendurado cai no secundário após ai_timeout (fallback preservado)', async () => {
    const config = require('../../api/utils/config');
    config.get.mockReturnValue(true); // habilita fallback secundário

    const hanging = { generate: jest.fn(() => new Promise(() => {})) };
    const fallback = { generate: jest.fn(async () => 'fallback') };
    registerAiProvider('openai', hanging);
    registerAiProvider('local', fallback);
    setTenantAiConfig('tenant-1', { primary: 'openai', secondary: 'local' });

    const provider = getAiProviderForTenant('tenant-1');
    await expect(provider.generate('hi', {})).resolves.toBe('fallback');
    expect(fallback.generate).toHaveBeenCalled();
  });
});

describe('aiProviderManager - memoização do provider por tenant', () => {
  beforeEach(() => {
    clearAiProviderConfig();
    delete process.env.ENGINE_AI_TIMEOUT_MS;
  });

  test('resolve uma única vez por tenant e invalida quando a config muda', async () => {
    const first = { generate: jest.fn(async () => 'v1') };
    registerAiProvider('openai', first);
    setTenantAiConfig('tenant-1', { primary: 'openai' });

    const providerA = getAiProviderForTenant('tenant-1');
    const providerA2 = getAiProviderForTenant('tenant-1');
    expect(providerA2).toBe(providerA); // memoizado

    // Mudança de config do tenant invalida a memo
    const second = { generate: jest.fn(async () => 'v2') };
    registerAiProvider('local', second);
    setTenantAiConfig('tenant-1', { primary: 'local' });

    const providerB = getAiProviderForTenant('tenant-1');
    expect(providerB).not.toBe(providerA);
    await expect(providerB.generate('hi', {})).resolves.toBe('v2');
  });

  test('registrar provider com mesmo id invalida a memo (instância substituída)', async () => {
    const first = { generate: jest.fn(async () => 'v1') };
    registerAiProvider('openai', first);
    setTenantAiConfig('tenant-1', { primary: 'openai' });

    const providerA = getAiProviderForTenant('tenant-1');
    await expect(providerA.generate('hi', {})).resolves.toBe('v1');

    const replacement = { generate: jest.fn(async () => 'v2') };
    registerAiProvider('openai', replacement);

    const providerB = getAiProviderForTenant('tenant-1');
    expect(providerB).not.toBe(providerA);
    await expect(providerB.generate('hi', {})).resolves.toBe('v2');
  });
});

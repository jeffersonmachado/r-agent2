'use strict';

/**
 * Roteamento engine-wide (item de remoção de primary/secondary):
 *
 * Sem `setTenantAiConfig` para o tenant, `getAiProviderForTenant` deve rotear
 * por TODOS os providers registrados, pulando provider sem credencial
 * (AI_PROVIDER_NOT_CONFIGURED) e lançando o último erro quando todos falham.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/utils/config', () => ({
  get: jest.fn(() => false),
}));

const {
  registerAiProvider,
  getAiProviderForTenant,
  clearAiProviderConfig,
} = require('../../api/services/aiProviderManager.js');

describe('aiProviderManager — roteamento engine-wide (sem config por tenant)', () => {
  beforeEach(() => {
    clearAiProviderConfig();
  });

  test('sem config por tenant, roteia por todos e usa o provider com credencial', async () => {
    const notConfigured = jest.fn(async () => {
      const err = new Error('sem chave');
      err.code = 'AI_PROVIDER_NOT_CONFIGURED';
      throw err;
    });
    const ok = jest.fn(async () => ({ text: 'ok' }));

    registerAiProvider('openai', { generate: notConfigured });
    registerAiProvider('anthropic', { generate: ok });

    const provider = getAiProviderForTenant('tenant-sem-config');
    const result = await provider.generate('hi', { tenantId: 'tenant-sem-config' });

    expect(result.text).toBe('ok');
    expect(notConfigured).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  test('primeiro provider falha com erro transitório → tenta o próximo', async () => {
    const fail = jest.fn(async () => {
      const err = new Error('service unavailable');
      err.status = 503;
      throw err;
    });
    const ok = jest.fn(async () => ({ text: 'from-second' }));

    registerAiProvider('openai', { generate: fail });
    registerAiProvider('anthropic', { generate: ok });

    const provider = getAiProviderForTenant('t');
    const result = await provider.generate('hi', {});

    expect(result.text).toBe('from-second');
    expect(fail).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  test('todos falham → lança o último erro', async () => {
    const fail1 = jest.fn(async () => { throw new Error('down-1'); });
    const fail2 = jest.fn(async () => { throw new Error('down-2'); });
    registerAiProvider('openai', { generate: fail1 });
    registerAiProvider('anthropic', { generate: fail2 });

    const provider = getAiProviderForTenant('t');
    await expect(provider.generate('hi', {})).rejects.toThrow('down-2');
    expect(fail1).toHaveBeenCalledTimes(1);
    expect(fail2).toHaveBeenCalledTimes(1);
  });

  test('bloqueio duro (403 policy denial) não cascateia para o próximo provider', async () => {
    const denied = jest.fn(async () => {
      const err = new Error('prohibited');
      err.status = 403;
      throw err;
    });
    const ok = jest.fn(async () => ({ text: 'ok' }));

    registerAiProvider('openai', { generate: denied });
    registerAiProvider('anthropic', { generate: ok });

    const provider = getAiProviderForTenant('t');
    await expect(provider.generate('hi', {})).rejects.toThrow('prohibited');
    expect(denied).toHaveBeenCalledTimes(1);
    expect(ok).not.toHaveBeenCalled();
  });

  test('nenhum provider registrado → null', () => {
    expect(getAiProviderForTenant('t')).toBeNull();
  });
});

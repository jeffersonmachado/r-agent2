'use strict';

/**
 * Achado real de um pilot com providers de IA reais: `kimi:moonshot-v1-128k` (mapeado
 * estaticamente em `modelCapabilities.js`, a allowlist de segurança do Engineering Router)
 * retornou "Not found the model ... or Permission denied" só na primeira tentativa de uso real
 * — nada verificava PROATIVAMENTE se um modelo mapeado ainda estava habilitado para a
 * credencial configurada. `listAvailableModelIds` reaproveita o MESMO endpoint `GET
 * {baseUrl}/models` já usado por `validateProviderCredentials` (nunca uma segunda chamada de
 * rede em paralelo); `providerModelDiscoveryCache` evita martelar esse endpoint a cada seleção.
 */

jest.mock('../../api/services/aiProviderRegistryService', () => ({
  getProviderDef: jest.fn(),
}));

const { getProviderDef } = require('../../api/services/aiProviderRegistryService');
const { listAvailableModelIds } = require('../../api/services/aiCredentialValidation');

describe('aiCredentialValidation.listAvailableModelIds', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  test('openai-compatible: extrai os ids reais de GET {baseUrl}/models', async () => {
    getProviderDef.mockResolvedValue({ kind: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'moonshot-v1-8k' }, { id: 'moonshot-v1-32k' }] }),
    });

    const ids = await listAvailableModelIds('kimi', 'real-key');

    expect(ids).toEqual(['moonshot-v1-8k', 'moonshot-v1-32k']);
    expect(global.fetch).toHaveBeenCalledWith('https://api.moonshot.ai/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer real-key' },
    }));
  });

  test('anthropic: usa x-api-key + anthropic-version, não Bearer', async () => {
    getProviderDef.mockResolvedValue({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'claude-sonnet-5' }] }),
    });

    const ids = await listAvailableModelIds('anthropic', 'real-key');

    expect(ids).toEqual(['claude-sonnet-5']);
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers).toMatchObject({ 'x-api-key': 'real-key', 'anthropic-version': '2023-06-01' });
  });

  test('HTTP não-ok (ex.: 401/403) retorna null — nunca lança, nunca finge lista vazia como "sem modelos"', async () => {
    getProviderDef.mockResolvedValue({ kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    const ids = await listAvailableModelIds('deepseek', 'chave-invalida');

    expect(ids).toBeNull();
  });

  test('erro de rede/timeout retorna null (fail-open), nunca lança', async () => {
    getProviderDef.mockResolvedValue({ kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' });
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

    await expect(listAvailableModelIds('deepseek', 'k')).resolves.toBeNull();
  });

  test('provider não suportado (getProviderDef retorna null) retorna null sem tentar rede', async () => {
    getProviderDef.mockResolvedValue(null);
    global.fetch = jest.fn();

    const ids = await listAvailableModelIds('provider-inexistente', 'k');

    expect(ids).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sem apiKey retorna null sem tentar rede', async () => {
    global.fetch = jest.fn();
    const ids = await listAvailableModelIds('kimi', '');
    expect(ids).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('resposta com data.data não sendo array retorna null (formato inesperado)', async () => {
    getProviderDef.mockResolvedValue({ kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'formato inesperado' }) });

    const ids = await listAvailableModelIds('deepseek', 'k');

    expect(ids).toBeNull();
  });
});

describe('providerModelDiscoveryCache.resolveKnownModelIds', () => {
  let providerModelDiscoveryCache;
  let aiCredentialValidation;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../api/services/aiCredentialValidation', () => ({ listAvailableModelIds: jest.fn() }));
    // eslint-disable-next-line global-require
    providerModelDiscoveryCache = require('../../api/services/engineeringRouter/providerModelDiscoveryCache');
    // eslint-disable-next-line global-require
    aiCredentialValidation = require('../../api/services/aiCredentialValidation');
    providerModelDiscoveryCache._clearAllForTests();
  });

  test('primeira chamada consulta a API real; segunda chamada usa o cache (nunca consulta de novo)', async () => {
    aiCredentialValidation.listAvailableModelIds.mockResolvedValue(['modelo-a', 'modelo-b']);

    const first = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'system', 'key');
    const second = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'system', 'key');

    expect(first).toEqual(['modelo-a', 'modelo-b']);
    expect(second).toEqual(['modelo-a', 'modelo-b']);
    expect(aiCredentialValidation.listAvailableModelIds).toHaveBeenCalledTimes(1);
  });

  test('resultado null (falha/não suportado) NUNCA é cacheado — próxima chamada tenta de novo', async () => {
    aiCredentialValidation.listAvailableModelIds.mockResolvedValueOnce(null).mockResolvedValueOnce(['modelo-a']);

    const first = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'system', 'key');
    const second = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'system', 'key');

    expect(first).toBeNull();
    expect(second).toEqual(['modelo-a']);
    expect(aiCredentialValidation.listAvailableModelIds).toHaveBeenCalledTimes(2);
  });

  test('tenants diferentes têm entradas de cache separadas (nunca vaza credencial/resultado entre tenants)', async () => {
    aiCredentialValidation.listAvailableModelIds
      .mockResolvedValueOnce(['modelo-tenant-a'])
      .mockResolvedValueOnce(['modelo-tenant-b']);

    const forA = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'tenant-a', 'key-a');
    const forB = await providerModelDiscoveryCache.resolveKnownModelIds('kimi', 'tenant-b', 'key-b');

    expect(forA).toEqual(['modelo-tenant-a']);
    expect(forB).toEqual(['modelo-tenant-b']);
    expect(aiCredentialValidation.listAvailableModelIds).toHaveBeenCalledTimes(2);
  });
});

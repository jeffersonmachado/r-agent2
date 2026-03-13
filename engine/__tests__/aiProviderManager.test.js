jest.mock('../../api/utils/config', () => ({
  get: jest.fn(() => true),
}));

const config = require('../../api/utils/config');

const {
  registerAiProvider,
  setTenantAiConfig,
  getAiProviderForTenant,
  clearAiProviderConfig,
} = require('../aiProviderManager');

describe('aiProviderManager', () => {
  beforeEach(() => {
    clearAiProviderConfig();
    config.get.mockReturnValue(true);
  });

  test('seleciona provider primário por tenant', async () => {
    const primary = {
      generate: jest.fn().mockResolvedValue('primary'),
    };

    registerAiProvider('openai', primary);
    setTenantAiConfig('tenant-1', { primary: 'openai' });

    const provider = getAiProviderForTenant('tenant-1');
    expect(provider).not.toBeNull();

    const result = await provider.generate('hi', {});
    expect(result).toBe('primary');
    expect(primary.generate).toHaveBeenCalled();
  });

  test('usa fallback se provider primário falhar', async () => {
    const primary = {
      generate: jest.fn().mockRejectedValue(new Error('primary fail')),
    };
    const fallback = {
      generate: jest.fn().mockResolvedValue('fallback'),
    };

    registerAiProvider('openai', primary);
    registerAiProvider('local', fallback);

    setTenantAiConfig('tenant-1', { primary: 'openai', secondary: 'local' });

    const provider = getAiProviderForTenant('tenant-1');
    const result = await provider.generate('hi', {});

    expect(result).toBe('fallback');
    expect(primary.generate).toHaveBeenCalled();
    expect(fallback.generate).toHaveBeenCalled();
  });

  test('retorna null se tenant não tiver config', () => {
    const provider = getAiProviderForTenant('unknown-tenant');
    expect(provider).toBeNull();
  });
});



'use strict';

/**
 * Failover de provider (item 100) e fail-closed do roteamento (item 39):
 *
 * "Anthropic outage → circuit breaker → eligible peer provider" e
 * "provider única cai → circuit breaker abre → falha fechada sem retry storm".
 *
 * Exercita a fiação real: `engine/aiProviderManager` (composite com
 * secundário) + `api/services/aiControlPlaneStatus` (circuit breaker central).
 */

jest.mock('../../api/utils/config', () => ({
  get: jest.fn(() => true), // fallbacks.aiProviderSecondary = true
}));

const config = require('../../api/utils/config');
const aiControlPlaneStatus = require('../../api/services/aiControlPlaneStatus');
const {
  registerAiProvider,
  setTenantAiConfig,
  getAiProviderForTenant,
  clearAiProviderConfig,
} = require('../../api/services/aiProviderManager.js');

describe('provider outage — failover e fail-closed', () => {
  beforeEach(() => {
    // resetMocks: true apaga a implementação de jest.fn(() => true) a cada teste.
    config.get.mockReturnValue(true);
    aiControlPlaneStatus.resetAiControlPlaneState();
    clearAiProviderConfig();
  });

  test('Anthropic outage → circuit breaker → eligible peer provider (OpenAI)', async () => {
    const anthropicGenerate = jest.fn(async () => {
      const err = new Error('anthropic service unavailable');
      err.status = 503;
      throw err;
    });
    const openaiGenerate = jest.fn(async () => ({ text: 'ok-from-openai' }));

    registerAiProvider('anthropic', {
      generate: aiControlPlaneStatus.wrapProviderGenerate('anthropic', anthropicGenerate),
    });
    registerAiProvider('openai', {
      generate: aiControlPlaneStatus.wrapProviderGenerate('openai', openaiGenerate),
    });
    setTenantAiConfig('tenant-1', { primary: 'anthropic', secondary: 'openai' });

    const provider = getAiProviderForTenant('tenant-1');
    const result = await provider.generate('hi', {});

    expect(result.text).toBe('ok-from-openai');
    expect(anthropicGenerate).toHaveBeenCalledTimes(1);
    expect(openaiGenerate).toHaveBeenCalledTimes(1);
    // A falha do primário foi registrada no breaker central do provider.
    expect(aiControlPlaneStatus.getProviderBreaker('anthropic').getState().consecutiveFailures).toBe(1);
    expect(aiControlPlaneStatus.getProviderBreaker('openai').getState().state).toBe('closed');
  });

  test('provider único cai: breaker abre e falha fechado sem ir à rede', async () => {
    const anthropicGenerate = jest.fn(async () => {
      const err = new Error('anthropic service unavailable');
      err.status = 503;
      throw err;
    });

    registerAiProvider('anthropic', {
      generate: aiControlPlaneStatus.wrapProviderGenerate('anthropic', anthropicGenerate),
    });
    setTenantAiConfig('tenant-2', { primary: 'anthropic' });

    const provider = getAiProviderForTenant('tenant-2');

    // 3 falhas consecutivas abrem o breaker (threshold default 3).
    for (let i = 0; i < 3; i += 1) {
      await expect(provider.generate('hi', {})).rejects.toThrow('anthropic service unavailable');
    }
    expect(aiControlPlaneStatus.getProviderBreaker('anthropic').getState().state).toBe('open');

    // Chamada seguinte NÃO vai à rede: falha fechada com código explícito.
    await expect(provider.generate('hi', {})).rejects.toMatchObject({ code: 'provider_circuit_open' });
    expect(anthropicGenerate).toHaveBeenCalledTimes(3);
  });
});

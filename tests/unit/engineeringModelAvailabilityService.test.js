'use strict';

/**
 * Achado real do pilot: uma credencial de IA restaurada (nunca mais apagada, ver
 * tenant_ai_credentials.status) mas com o último teste real confirmando `no_credit` continuava
 * sendo escolhida pelo Engineering Router como CODER/REVIEWER mais barato — o circuit breaker
 * do AI Control Plane não abre para erros de billing (são específicos de uma credencial, não do
 * provider estar fora do ar para todo mundo). Corrigido em
 * api/services/engineeringRouter/engineeringModelAvailabilityService.js: o status persistido da
 * credencial agora também entra na elegibilidade de roteamento, sem apagar nada.
 */

jest.mock('../../api/services/aiProviderRegistryService', () => ({
  getRuntimeProviders: jest.fn(async () => ({
    openai: { enabled: true },
    deepseek: { enabled: true },
  })),
}));

jest.mock('../../api/services/aiControlPlaneStatus', () => ({
  getBreakerStates: jest.fn(() => []),
}));

jest.mock('../../api/services/tenantAIService', () => ({
  getCredentialDetailsMap: jest.fn(),
}));

const { buildAvailableModels } = require('../../api/services/engineeringRouter/engineeringModelAvailabilityService');
const { getCredentialDetailsMap } = require('../../api/services/tenantAIService');
const { getRuntimeProviders } = require('../../api/services/aiProviderRegistryService');
const { getBreakerStates } = require('../../api/services/aiControlPlaneStatus');

describe('engineeringModelAvailabilityService.buildAvailableModels — elegibilidade por status real', () => {
  // jest.config.cjs tem resetMocks:true — o retorno definido na factory do jest.mock() é
  // limpo antes de cada teste, então os defaults têm que ser reafirmados aqui.
  beforeEach(() => {
    getRuntimeProviders.mockResolvedValue({ openai: { enabled: true }, deepseek: { enabled: true } });
    getBreakerStates.mockReturnValue([]);
  });

  test('credencial com status no_credit não conta como usável, mesmo com hasCredential=true', async () => {
    getCredentialDetailsMap.mockResolvedValue({
      openai: { hasCredential: true, status: 'valid' },
      deepseek: { hasCredential: true, status: 'no_credit' },
    });

    const models = await buildAvailableModels({ tenantId: 'system' });

    const deepseekModels = models.filter((m) => m.providerId === 'deepseek');
    const openaiModels = models.filter((m) => m.providerId === 'openai');

    expect(deepseekModels.length).toBeGreaterThan(0);
    expect(deepseekModels.every((m) => m.hasCredential === false)).toBe(true);
    expect(openaiModels.some((m) => m.hasCredential === true)).toBe(true);
  });

  test('credencial com status invalid_token também é tratada como não usável', async () => {
    getCredentialDetailsMap.mockResolvedValue({
      openai: { hasCredential: true, status: 'invalid_token' },
    });

    const models = await buildAvailableModels({ tenantId: 'system' });
    const openaiModels = models.filter((m) => m.providerId === 'openai');

    expect(openaiModels.length).toBeGreaterThan(0);
    expect(openaiModels.every((m) => m.hasCredential === false)).toBe(true);
  });

  test('status unknown (nunca testado) continua elegível — não penaliza quem ainda não testou', async () => {
    getCredentialDetailsMap.mockResolvedValue({
      openai: { hasCredential: true, status: 'unknown' },
    });

    const models = await buildAvailableModels({ tenantId: 'system' });
    const openaiModels = models.filter((m) => m.providerId === 'openai');

    expect(openaiModels.some((m) => m.hasCredential === true)).toBe(true);
  });

  test('sem credencial nenhuma (hasCredential=false) continua indisponível, independente do status', async () => {
    getCredentialDetailsMap.mockResolvedValue({
      openai: { hasCredential: false, status: 'unknown' },
    });

    const models = await buildAvailableModels({ tenantId: 'system' });
    const openaiModels = models.filter((m) => m.providerId === 'openai');

    expect(openaiModels.every((m) => m.hasCredential === false)).toBe(true);
  });

  test('falha ao consultar tenantAIService não derruba a montagem da lista (fail-closed)', async () => {
    getCredentialDetailsMap.mockRejectedValue(new Error('db indisponível'));

    const models = await buildAvailableModels({ tenantId: 'system' });

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.hasCredential === false)).toBe(true);
  });
});

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
  getDecryptedAPIKey: jest.fn(),
}));

jest.mock('../../api/services/engineeringRouter/providerModelDiscoveryCache', () => ({
  resolveKnownModelIds: jest.fn(),
}));

const { buildAvailableModels } = require('../../api/services/engineeringRouter/engineeringModelAvailabilityService');
const { getCredentialDetailsMap, getDecryptedAPIKey } = require('../../api/services/tenantAIService');
const { getRuntimeProviders } = require('../../api/services/aiProviderRegistryService');
const { getBreakerStates } = require('../../api/services/aiControlPlaneStatus');
const providerModelDiscoveryCache = require('../../api/services/engineeringRouter/providerModelDiscoveryCache');

describe('engineeringModelAvailabilityService.buildAvailableModels — elegibilidade por status real', () => {
  // jest.config.cjs tem resetMocks:true — o retorno definido na factory do jest.mock() é
  // limpo antes de cada teste, então os defaults têm que ser reafirmados aqui.
  beforeEach(() => {
    getRuntimeProviders.mockResolvedValue({ openai: { enabled: true }, deepseek: { enabled: true } });
    getBreakerStates.mockReturnValue([]);
    // Fail-open por padrão: sem API key/descoberta real, o filtro de discovery de modelos não
    // se aplica (comportamento pré-existente preservado) — cada teste de discovery sobrescreve.
    getDecryptedAPIKey.mockResolvedValue(null);
    providerModelDiscoveryCache.resolveKnownModelIds.mockResolvedValue(null);
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

describe('engineeringModelAvailabilityService.buildAvailableModels — discovery proativo de modelos reais', () => {
  // Achado real de um pilot com providers de IA reais: kimi:kimi-k2.6 (mapeado em
  // modelCapabilities.js) retornou "Not found the model ... or Permission denied" só na
  // primeira tentativa de uso real — nada verificava PROATIVAMENTE se um modelo mapeado ainda
  // estava habilitado para a credencial configurada.
  beforeEach(() => {
    getRuntimeProviders.mockResolvedValue({ openai: { enabled: true }, deepseek: { enabled: true }, kimi: { enabled: true } });
    getBreakerStates.mockReturnValue([]);
  });

  test('modelo mapeado que NÃO está na lista real do provider vira indisponível (MODEL_NOT_LISTED_BY_PROVIDER)', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'valid' } });
    getDecryptedAPIKey.mockResolvedValue('fake-real-key');
    // A API real do provider (achado real do pilot) não lista o único modelo kimi mapeado
    // estaticamente (kimi-k2.6) — só outro modelo qualquer, irrelevante para nós.
    providerModelDiscoveryCache.resolveKnownModelIds.mockResolvedValue(['moonshot-v1-8k']);

    const models = await buildAvailableModels({ tenantId: 'system' });
    const target = models.find((m) => m.providerId === 'kimi' && m.modelId === 'kimi-k2.6');

    expect(target).toBeDefined();
    expect(target.available).toBe(false);
    expect(target.availabilityReason).toBe('MODEL_NOT_LISTED_BY_PROVIDER');
  });

  test('modelo mapeado que ESTÁ na lista real do provider continua disponível', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'valid' } });
    getDecryptedAPIKey.mockResolvedValue('fake-real-key');
    providerModelDiscoveryCache.resolveKnownModelIds.mockResolvedValue(['kimi-k2.6']);

    const models = await buildAvailableModels({ tenantId: 'system' });
    const target = models.find((m) => m.providerId === 'kimi' && m.modelId === 'kimi-k2.6');

    expect(target).toBeDefined();
    expect(target.available).toBe(true);
  });

  test('discovery indisponível (null — provider não suporta ou consulta falhou) nunca filtra nada (fail-open)', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'valid' } });
    getDecryptedAPIKey.mockResolvedValue('fake-real-key');
    providerModelDiscoveryCache.resolveKnownModelIds.mockResolvedValue(null);

    const models = await buildAvailableModels({ tenantId: 'system' });
    const kimiModels = models.filter((m) => m.providerId === 'kimi');

    expect(kimiModels.some((m) => m.available === true)).toBe(true);
  });

  test('sem credencial usável, nunca tenta descobrir modelos reais (nem chama getDecryptedAPIKey)', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: false, status: 'unknown' } });

    await buildAvailableModels({ tenantId: 'system' });

    expect(getDecryptedAPIKey).not.toHaveBeenCalledWith(expect.anything(), 'kimi');
  });

  test('credencial com hasCredential=true mas status "unknown" (nunca testada) NUNCA dispara discovery — evita chamada de rede real com chave possivelmente fake', async () => {
    // Achado real ao integrar o discovery: testes E2E do Router salvam credenciais FAKE com
    // status default "unknown" (nunca testadas via rota de teste real). Sem esta restrição,
    // cada seleção de modelo faria uma chamada de REDE REAL contra a API do provider com uma
    // chave fake, tornando testes que deveriam ser herméticos lentos/dependentes de rede.
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'unknown' } });

    await buildAvailableModels({ tenantId: 'system' });

    expect(getDecryptedAPIKey).not.toHaveBeenCalled();
    expect(providerModelDiscoveryCache.resolveKnownModelIds).not.toHaveBeenCalled();
  });

  test('falha ao descobrir modelos reais (exceção) nunca derruba a montagem da lista (fail-open)', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'valid' } });
    getDecryptedAPIKey.mockRejectedValue(new Error('erro de decriptação'));

    const models = await buildAvailableModels({ tenantId: 'system' });
    const kimiModels = models.filter((m) => m.providerId === 'kimi');

    expect(kimiModels.some((m) => m.hasCredential === true)).toBe(true);
  });

  test('um estado reativo já mais específico (ex.: RATE_LIMITED) nunca é sobrescrito pelo discovery proativo', async () => {
    getCredentialDetailsMap.mockResolvedValue({ kimi: { hasCredential: true, status: 'valid' } });
    getDecryptedAPIKey.mockResolvedValue('fake-real-key');
    // O modelo ESTÁ na lista real (discovery diria "disponível"), mas uma falha reativa recente
    // (ex.: rate limit) já marcou o estado — o motivo mais específico não pode ser perdido.
    providerModelDiscoveryCache.resolveKnownModelIds.mockResolvedValue(['kimi-k2.6']);
    const modelAvailabilityStore = require('../../api/services/engineeringRouter/modelAvailabilityStore');
    modelAvailabilityStore.markUnavailable('kimi', 'kimi-k2.6', { state: 'RATE_LIMITED', reason: 'rate limit', ttlMs: 60000 });

    const models = await buildAvailableModels({ tenantId: 'system' });
    const target = models.find((m) => m.providerId === 'kimi' && m.modelId === 'kimi-k2.6');

    expect(target.available).toBe(false);
    expect(target.availabilityReason).toBe('rate limit');
    modelAvailabilityStore.markAvailable('kimi', 'kimi-k2.6');
  });
});

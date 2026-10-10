'use strict';

/**
 * Resolução do LLM do RAG pelo roteamento do tenant.
 *
 * Defeito medido em 2026-10-08: `queryRag` fixava
 * `getDecryptedAPIKey(tenantId, 'openai')`. Um tenant roteado para
 * deepseek/kimi (Configuração > IA) continuava gerando com a chave OpenAI,
 * recebia 429 sem crédito e o rag-service devolvia um trecho cru que o Ask AI
 * apresentava como resposta fundamentada.
 *
 * Este arquivo fixa o contrato novo: a rota do tenant é seguida, o endpoint
 * (base_url) e o modelo acompanham o provider, providers com protocolo próprio
 * (anthropic) e sem credencial são pulados, `openai` fica como último recurso e
 * a chave nunca é logada.
 */

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockGetSequelize = jest.fn(() => ({}));
const mockGetAIConfig = jest.fn();
const mockGetDecryptedAPIKey = jest.fn();
const mockGetProviderDef = jest.fn();

jest.mock('../../api/utils/logger', () => mockLogger);
jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));
jest.mock('../../api/services/tenantAIService', () => ({
  getAIConfig: (...args) => mockGetAIConfig(...args),
  getDecryptedAPIKey: (...args) => mockGetDecryptedAPIKey(...args),
}));
jest.mock('../../api/services/aiProviderRegistryService', () => ({
  getProviderDef: (...args) => mockGetProviderDef(...args),
}));

const ragService = require('../../api/services/ragService');

const { resolveTenantLlmHeaders } = ragService._internal;

// Catálogo equivalente ao banco real (`ai_providers`).
const PROVIDERS = {
  anthropic: {
    key: 'anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5',
  },
  deepseek: {
    key: 'deepseek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
  },
  kimi: {
    key: 'kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.6',
  },
  openai: {
    key: 'openai',
    kind: 'openai-sdk',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.2',
  },
};

function setupRoteamento({ primary = null, secondary = null, model = null, credentials = {} } = {}) {
  mockGetAIConfig.mockResolvedValue({
    primary,
    secondary,
    model,
    configured: Boolean(primary),
    providers: {},
  });
  mockGetDecryptedAPIKey.mockImplementation(async (_tenantId, provider) => credentials[provider] || null);
  mockGetProviderDef.mockImplementation(async (key) => PROVIDERS[key] || null);
}

describe('ragService — LLM do RAG segue o roteamento do tenant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
  });

  test('usa o provider primário com endpoint e modelo do catálogo', async () => {
    setupRoteamento({
      primary: 'deepseek',
      secondary: 'kimi',
      credentials: { deepseek: 'sk-teste-deepseek' },
    });

    const headers = await resolveTenantLlmHeaders('system');

    expect(headers['X-RAG-LLM-Provider']).toBe('deepseek');
    expect(headers['X-RAG-LLM-Base-URL']).toBe('https://api.deepseek.com/v1');
    expect(headers['X-RAG-LLM-Model']).toBe('deepseek-flash');
    expect(headers['X-RAG-LLM-API-Key']).toBe('sk-teste-deepseek');
  });

  test('pula provider com protocolo próprio (anthropic) e usa o secundário', async () => {
    setupRoteamento({
      primary: 'anthropic',
      secondary: 'kimi',
      credentials: { anthropic: 'sk-teste-anthropic', kimi: 'sk-teste-kimi' },
    });

    const headers = await resolveTenantLlmHeaders('system');

    // anthropic não fala o protocolo da OpenAI (SDK usado pelo rag-service).
    expect(headers['X-RAG-LLM-Provider']).toBe('kimi');
    expect(headers['X-RAG-LLM-Base-URL']).toBe('https://api.moonshot.ai/v1');
  });

  test('pula provider sem credencial e segue para o próximo da rota', async () => {
    setupRoteamento({
      primary: 'deepseek',
      secondary: 'kimi',
      credentials: { kimi: 'sk-teste-kimi' },
    });

    const headers = await resolveTenantLlmHeaders('system');

    expect(headers['X-RAG-LLM-Provider']).toBe('kimi');
  });

  test('openai permanece como último recurso quando não há roteamento', async () => {
    setupRoteamento({ credentials: { openai: 'sk-teste-openai' } });

    const headers = await resolveTenantLlmHeaders('system');

    expect(headers['X-RAG-LLM-Provider']).toBe('openai');
    expect(headers['X-RAG-LLM-Base-URL']).toBe('https://api.openai.com/v1');
  });

  test('modelo do tenant vale apenas para o provider primário', async () => {
    setupRoteamento({
      primary: 'deepseek',
      secondary: 'kimi',
      model: 'deepseek-custom',
      credentials: { deepseek: 'sk-teste-deepseek' },
    });
    const primario = await resolveTenantLlmHeaders('system');
    expect(primario['X-RAG-LLM-Model']).toBe('deepseek-custom');

    // Resolvido pelo secundário: o modelo do tenant era da rota primária.
    setupRoteamento({
      primary: 'deepseek',
      secondary: 'kimi',
      model: 'deepseek-custom',
      credentials: { kimi: 'sk-teste-kimi' },
    });
    const secundario = await resolveTenantLlmHeaders('system');
    expect(secundario['X-RAG-LLM-Provider']).toBe('kimi');
    expect(secundario['X-RAG-LLM-Model']).toBe('kimi-k2.6');
  });

  test('devolve vazio (degradação declarada) quando nada é resolvível', async () => {
    setupRoteamento({ primary: 'deepseek', secondary: 'kimi', credentials: {} });

    const headers = await resolveTenantLlmHeaders('system');

    expect(headers).toEqual({});
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test('sem conexão Sequelize não consulta configuração (testes de unidade)', async () => {
    mockGetSequelize.mockReturnValue(null);
    setupRoteamento({ credentials: { deepseek: 'sk-teste-deepseek' } });

    const headers = await resolveTenantLlmHeaders('system');

    expect(headers).toEqual({});
    expect(mockGetAIConfig).not.toHaveBeenCalled();
  });

  test('a credencial nunca aparece nos logs', async () => {
    setupRoteamento({
      primary: 'deepseek',
      credentials: { deepseek: 'sk-segredo-que-nao-pode-ser-logado' },
    });

    await resolveTenantLlmHeaders('system');

    const logged = JSON.stringify([
      ...mockLogger.debug.mock.calls,
      ...mockLogger.info.mock.calls,
      ...mockLogger.warn.mock.calls,
      ...mockLogger.error.mock.calls,
    ]);
    expect(logged).not.toContain('sk-segredo-que-nao-pode-ser-logado');
  });
});

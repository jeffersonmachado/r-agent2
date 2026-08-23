'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockAiProviderModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

const mockTenantAICredentialModel = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn(),
};

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({ fake: true })),
  connect: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../api/db/models', () => ({
  AiProvider: () => mockAiProviderModel,
  TenantAICredential: () => mockTenantAICredentialModel,
}));

const sequelizeMock = require('../../api/db/sequelize');
const registry = require('../../api/services/aiProviderRegistryService');

describe('aiProviderRegistryService — runtime merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelizeMock.getSequelize.mockReturnValue({ fake: true });
    sequelizeMock.connect.mockResolvedValue(true);
    mockAiProviderModel.findAll.mockResolvedValue([]);
    registry.invalidateRuntimeCache();
  });

  test('sem conexão retorna os built-ins do engine registry (≥ 6)', async () => {
    sequelizeMock.getSequelize.mockReturnValueOnce(null);
    const providers = await registry.getRuntimeProviders();
    const ids = Object.keys(providers);
    for (const id of ['openai', 'anthropic', 'deepseek', 'kimi', 'mistral', 'groq']) {
      expect(ids).toContain(id);
    }
    expect(providers.openai.kind).toBe('openai-sdk');
    expect(providers.anthropic.kind).toBe('anthropic');
    expect(providers.deepseek.kind).toBe('openai-compatible');
  });

  test('provider custom do DB entra na mescla', async () => {
    mockAiProviderModel.findAll.mockResolvedValueOnce([{
      key: 'cohere',
      label: 'Cohere',
      kind: 'openai-compatible',
      base_url: 'https://api.cohere.com/v1',
      default_model: 'command-r-plus',
      models: [{ value: 'command-r-plus', label: 'Command R+' }],
      validation_model: null,
      is_builtin: false,
      enabled: true,
    }]);
    const providers = await registry.getRuntimeProviders();
    expect(providers.cohere).toBeDefined();
    expect(providers.cohere.isBuiltin).toBe(false);
    expect(providers.cohere.baseUrl).toBe('https://api.cohere.com/v1');
  });

  test('isSupportedProvider/getProviderDef consultam o runtime (case-insensitive)', async () => {
    expect(await registry.isSupportedProvider('openai')).toBe(true);
    expect(await registry.isSupportedProvider('OPENAI')).toBe(true);
    expect(await registry.isSupportedProvider('nao-existe')).toBe(false);
    const def = await registry.getProviderDef('OPENAI');
    expect(def).toBeDefined();
    expect(def.id).toBe('openai');
  });
});

describe('aiProviderRegistryService — CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelizeMock.getSequelize.mockReturnValue({ fake: true });
    sequelizeMock.connect.mockResolvedValue(true);
    registry.invalidateRuntimeCache();
  });

  test('createProvider valida e cria provider custom', async () => {
    mockAiProviderModel.findOne.mockResolvedValueOnce(null);
    mockAiProviderModel.create.mockResolvedValueOnce({ key: 'meu-provider' });
    const created = await registry.createProvider({
      key: 'meu-provider',
      label: 'Meu Provider',
      kind: 'openai-compatible',
      baseUrl: 'https://api.meu.com/v1',
      defaultModel: 'modelo-x',
      models: [{ value: 'modelo-x', label: 'Modelo X' }],
    });
    expect(created).toBeDefined();
    expect(mockAiProviderModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'meu-provider', is_builtin: false, enabled: true }),
    );
  });

  test('createProvider rejeita payload inválido', async () => {
    await expect(registry.createProvider({
      key: 'X',
      label: '',
      kind: 'x',
      baseUrl: 'x',
      defaultModel: '',
    })).rejects.toThrow(/key inválido|baseUrl/);
  });

  test('createProvider rejeita colisão com provider existente', async () => {
    mockAiProviderModel.findOne.mockResolvedValueOnce({ key: 'openai' });
    await expect(registry.createProvider({
      key: 'openai',
      label: 'OpenAI',
      kind: 'openai-sdk',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.2',
    })).rejects.toThrow(/já existe/);
  });

  test('deleteProvider bloqueia built-in com BUILTIN_PROVIDER_UNDELETABLE', async () => {
    mockAiProviderModel.findOne.mockResolvedValueOnce({ key: 'openai', is_builtin: true });
    await expect(registry.deleteProvider('openai')).rejects.toMatchObject({
      code: 'BUILTIN_PROVIDER_UNDELETABLE',
    });
  });

  test('deleteProvider remove provider custom', async () => {
    mockAiProviderModel.findOne.mockResolvedValueOnce({
      key: 'meu-provider',
      is_builtin: false,
      destroy: jest.fn().mockResolvedValue(true),
    });
    mockTenantAICredentialModel.destroy.mockResolvedValue(1);
    const result = await registry.deleteProvider('meu-provider');
    expect(result.deleted).toBe(true);
    expect(result.key).toBe('meu-provider');
    // Remove credenciais órfãs do provider
    expect(mockTenantAICredentialModel.destroy).toHaveBeenCalledWith({ where: { provider: 'meu-provider' } });
  });
});

'use strict';

/**
 * Regressão (tenantAIService.getAIConfig): era chamada por request e custava
 * 2 queries por chamada (tenant + tenant_ai_settings). Agora há cache em
 * memória com TTL de 60s chaveado pelo identifier exato, hit retorna cópia
 * (structuredClone) e saveAIConfig invalida as chaves afetadas.
 */

const mockAISettingFindOne = jest.fn();
const mockAISettingCreate = jest.fn();

const mockFindTenant = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
  connect: jest.fn(async () => ({})),
}));
jest.mock('../../api/db/models', () => ({
  Tenant: () => ({}),
  TenantAISetting: () => ({
    findOne: (...a) => mockAISettingFindOne(...a),
    create: (...a) => mockAISettingCreate(...a),
  }),
  TenantAICredential: () => ({ findOne: jest.fn(), create: jest.fn() }),
}));
jest.mock('../../api/services/tenantService', () => ({
  findTenantByIdentifier: (...a) => mockFindTenant(...a),
}));
jest.mock('../../api/utils/crypto', () => ({
  encrypt: jest.fn((v) => `enc:${v}`),
  decrypt: jest.fn((v) => v),
}));
jest.mock('../../api/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { getAIConfig, saveAIConfig, invalidateAIConfigCache, _internal } = require('../../api/services/tenantAIService');
const { getSequelize } = require('../../api/db/sequelize');

const OPENAI_SETTING = {
  primary: 'openai',
  provider: 'openai',
  secondary: null,
  enabled: true,
  model: 'gpt-4o',
  temperature: 0.7,
  max_tokens: 1000,
  quota_monthly: 50000,
};

describe('tenantAIService.getAIConfig — cache TTL 60s', () => {
  beforeEach(() => {
    // resetMocks global remove implementações — reestabelece aqui.
    _internal.clearAIConfigCache();
    getSequelize.mockReturnValue({});
    mockFindTenant.mockResolvedValue({ id: 'uuid-1', tenant_key: 'tenant-a' });
  });

  it('segunda chamada dentro do TTL não vai ao banco (cache hit)', async () => {
    mockAISettingFindOne.mockResolvedValue(OPENAI_SETTING);

    const c1 = await getAIConfig('tenant-a');
    const c2 = await getAIConfig('tenant-a');

    // Antes: 2 queries por chamada (4 no total).
    expect(mockAISettingFindOne).toHaveBeenCalledTimes(1);
    expect(c2).toEqual(c1);
    expect(c2).not.toBe(c1);
    expect(c1.primary).toBe('openai');
    expect(c1.configured).toBe(true);
  });

  it('hit retorna cópia: mutação do caller não corrompe o cache', async () => {
    mockAISettingFindOne.mockResolvedValue(OPENAI_SETTING);

    const c1 = await getAIConfig('tenant-a');
    c1.primary = 'anthropic';

    const c2 = await getAIConfig('tenant-a');
    expect(c2.primary).toBe('openai');
    expect(mockAISettingFindOne).toHaveBeenCalledTimes(1);
  });

  it('chave do cache é o identifier exato (tenant_key ≠ UUID)', async () => {
    mockAISettingFindOne.mockResolvedValue(null);

    await getAIConfig('tenant-a');
    await getAIConfig('uuid-1');
    expect(mockAISettingFindOne).toHaveBeenCalledTimes(2);

    await getAIConfig('tenant-a');
    expect(mockAISettingFindOne).toHaveBeenCalledTimes(2);
  });

  it('saveAIConfig invalida o cache e a leitura seguinte reflete a nova config', async () => {
    // 1) Sem setting: config padrão fica cacheada.
    mockAISettingFindOne.mockResolvedValueOnce(null);
    const before = await getAIConfig('tenant-a');
    expect(before.configured).toBe(false);

    // 2) save: lookup (sem existente) → create → invalida → getAIConfig recarrega.
    mockAISettingFindOne.mockResolvedValueOnce(null);
    mockAISettingCreate.mockResolvedValue({ id: 'new-setting' });
    mockAISettingFindOne.mockResolvedValueOnce({
      primary: 'anthropic',
      provider: 'anthropic',
      secondary: null,
      enabled: true,
      model: 'claude-3',
      temperature: null,
      max_tokens: null,
      quota_monthly: null,
    });

    const saved = await saveAIConfig('tenant-a', { primary: 'anthropic' });

    expect(saved.primary).toBe('anthropic');
    expect(saved.configured).toBe(true);
    expect(mockAISettingFindOne).toHaveBeenCalledTimes(3);
  });

  it('invalidateAIConfigCache força nova leitura', async () => {
    mockAISettingFindOne.mockResolvedValue(OPENAI_SETTING);

    await getAIConfig('tenant-a');
    invalidateAIConfigCache('tenant-a');
    await getAIConfig('tenant-a');

    expect(mockAISettingFindOne).toHaveBeenCalledTimes(2);
  });
});

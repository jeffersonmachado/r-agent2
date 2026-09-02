'use strict';

/**
 * Item 3 — Cache em memória (TTL curto) de tenantSettingsService.
 *
 * Elimina as 2 queries por request no hot path de requireTenantCapability:
 * (a) resolução tenant_key→UUID e (b) leitura do setting. Invalidação
 * explícita em upsertSetting; erros de DB nunca são cacheados (sem fallback
 * silencioso); chave sempre inclui o tenant.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Nota: resetMocks global — factory estável (sem jest.fn) para sobreviver ao
// reset por teste.
jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({}),
}));

const mockTenantFindOne = jest.fn();
const mockSettingFindOne = jest.fn();
const mockSettingCreate = jest.fn();

jest.mock('../../api/db/models', () => ({
  Tenant: () => ({ findOne: (...a) => mockTenantFindOne(...a) }),
  TenantSetting: () => ({
    findOne: (...a) => mockSettingFindOne(...a),
    create: (...a) => mockSettingCreate(...a),
  }),
}));

const {
  getSetting,
  upsertSetting,
  _internal,
} = require('../../api/services/tenantSettingsService');

function tenantRow(uuid) {
  return { id: uuid, toJSON() { return { id: uuid }; } };
}

function settingRow(value) {
  return {
    value,
    toJSON() { return { value }; },
    update: async (patch) => settingRow(patch && patch.value),
  };
}

describe('tenantSettingsService — cache com TTL e invalidação', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _internal.clearTenantSettingsCache();
  });

  test('getSetting faz 1 query de tenant + 1 de setting e reusa no segundo call', async () => {
    mockTenantFindOne.mockResolvedValue(tenantRow('uuid-1'));
    mockSettingFindOne.mockResolvedValue(settingRow({ caseManagement: false }));

    const first = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });
    const second = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });

    expect(first).toEqual({ ok: true, value: { caseManagement: false } });
    expect(second).toEqual({ ok: true, value: { caseManagement: false } });
    // Sem cache seriam 2 findOne em cada tabela (4 queries).
    expect(mockTenantFindOne).toHaveBeenCalledTimes(1);
    expect(mockSettingFindOne).toHaveBeenCalledTimes(1);
  });

  test('cache é por tenant+key (sem vazamento multi-tenant)', async () => {
    mockTenantFindOne.mockImplementation(async ({ where }) => (
      where.tenant_key === 'tenant-a' ? tenantRow('uuid-a') : tenantRow('uuid-b')
    ));
    mockSettingFindOne.mockImplementation(async ({ where }) => (
      where.tenant_id === 'uuid-a' ? settingRow({ f: 'a' }) : settingRow({ f: 'b' })
    ));

    const a1 = await getSetting({ tenantId: 'tenant-a', key: 'capabilities' });
    const b1 = await getSetting({ tenantId: 'tenant-b', key: 'capabilities' });
    const a2 = await getSetting({ tenantId: 'tenant-a', key: 'capabilities' });

    expect(a1.value).toEqual({ f: 'a' });
    expect(b1.value).toEqual({ f: 'b' });
    expect(a2.value).toEqual({ f: 'a' });
    expect(mockTenantFindOne).toHaveBeenCalledTimes(2);
    expect(mockSettingFindOne).toHaveBeenCalledTimes(2);
  });

  test('valor cacheado é clonado (mutação do caller não corrompe o cache)', async () => {
    mockTenantFindOne.mockResolvedValue(tenantRow('uuid-1'));
    mockSettingFindOne.mockResolvedValue(settingRow({ nested: { n: 1 } }));

    const first = await getSetting({ tenantId: 'tenant-1', key: 'k' });
    first.value.nested.n = 999;

    const second = await getSetting({ tenantId: 'tenant-1', key: 'k' });
    expect(second.value).toEqual({ nested: { n: 1 } });
    expect(mockSettingFindOne).toHaveBeenCalledTimes(1);
  });

  test('upsertSetting invalida o cache (próxima leitura vai ao DB)', async () => {
    mockTenantFindOne.mockResolvedValue(tenantRow('uuid-1'));
    mockSettingFindOne.mockResolvedValue(null); // não existe → cria
    mockSettingCreate.mockResolvedValue(settingRow({ caseManagement: false }));

    const before = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });
    expect(before).toEqual({ ok: true, value: null });

    const upsert = await upsertSetting({ tenantId: 'tenant-1', key: 'capabilities', value: { caseManagement: false } });
    expect(upsert.ok).toBe(true);

    // Leitura pós-upsert NÃO usou cache stale: nova query (mockClear zera o
    // findOne interno do próprio upsertSetting).
    mockSettingFindOne.mockClear();
    mockSettingFindOne.mockResolvedValue(settingRow({ caseManagement: false }));
    const after = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });
    expect(after).toEqual({ ok: true, value: { caseManagement: false } });
    expect(mockSettingFindOne).toHaveBeenCalledTimes(1);
  });

  test('upsert por tenant_key invalida também leituras feitas por UUID', async () => {
    const uuid = 'uuid-shared';
    mockTenantFindOne.mockResolvedValue(tenantRow(uuid));
    mockSettingFindOne.mockResolvedValue(settingRow({ v: 1 }));

    // Leitura "por UUID" (caller que já tem o UUID) popula o cache.
    const viaUuid = await getSetting({ tenantId: uuid, key: 'capabilities' });
    expect(viaUuid.value).toEqual({ v: 1 });

    mockSettingCreate.mockResolvedValue(settingRow({ v: 2 }));
    const upsert = await upsertSetting({ tenantId: 'tenant-1', key: 'capabilities', value: { v: 2 } });
    expect(upsert.ok).toBe(true);

    mockSettingFindOne.mockResolvedValue(settingRow({ v: 2 }));
    const afterViaUuid = await getSetting({ tenantId: uuid, key: 'capabilities' });
    expect(afterViaUuid.value).toEqual({ v: 2 });
  });

  test('erros de DB não são cacheados (falha explícita, sem fallback)', async () => {
    mockTenantFindOne.mockResolvedValue(tenantRow('uuid-1'));
    mockSettingFindOne.mockRejectedValueOnce(new Error('db down'));

    const failed = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe('db_error');

    mockSettingFindOne.mockResolvedValue(settingRow({ ok: 1 }));
    const retried = await getSetting({ tenantId: 'tenant-1', key: 'capabilities' });
    expect(retried).toEqual({ ok: true, value: { ok: 1 } });
    expect(mockSettingFindOne).toHaveBeenCalledTimes(2);
  });

  test('tenant_not_found não é cacheado (onboarding de tenant novo não trava)', async () => {
    mockTenantFindOne.mockResolvedValue(null); // tenant não existe

    const missing = await getSetting({ tenantId: 'tenant-new', key: 'capabilities' });
    expect(missing).toEqual({ ok: false, error: 'tenant_not_found' });

    // Tenant criado logo depois: a próxima leitura já resolve (sem esperar TTL).
    mockTenantFindOne.mockResolvedValue(tenantRow('uuid-new'));
    mockSettingFindOne.mockResolvedValue(null);
    const afterCreate = await getSetting({ tenantId: 'tenant-new', key: 'capabilities' });
    expect(afterCreate).toEqual({ ok: true, value: null });
    expect(mockTenantFindOne).toHaveBeenCalledTimes(2);
  });
});

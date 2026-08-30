'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockGetSetting = jest.fn();
const mockUpsertSetting = jest.fn();

jest.mock('../../api/services/tenantSettingsService', () => ({
  getSetting: (...args) => mockGetSetting(...args),
  upsertSetting: (...args) => mockUpsertSetting(...args),
}));

const {
  getTenantCapabilities,
  setTenantCapabilities,
  DEFAULT_CAPABILITIES,
} = require('../../api/services/tenantCapabilitiesService');

describe('tenantCapabilitiesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna defaults compatíveis quando não há setting persistido', async () => {
    mockGetSetting.mockResolvedValue({ ok: true, value: null });

    const caps = await getTenantCapabilities('tenant-1');

    expect(caps).toEqual({ inbox: true, caseManagement: true, caseCreationPolicy: 'manual' });
    expect(caps).toEqual(DEFAULT_CAPABILITIES);
  });

  test('tenant sem registro (tenant_not_found) recebe defaults', async () => {
    mockGetSetting.mockResolvedValue({ ok: false, error: 'tenant_not_found' });

    const caps = await getTenantCapabilities('tenant-x');

    expect(caps).toEqual(DEFAULT_CAPABILITIES);
  });

  test('falha de DB gera erro explícito (sem fallback)', async () => {
    mockGetSetting.mockResolvedValue({ ok: false, error: 'db_error', details: 'boom' });

    await expect(getTenantCapabilities('tenant-1')).rejects.toMatchObject({
      code: 'capabilities_db_error',
    });
  });

  test('set/get round-trip com merge validado', async () => {
    mockGetSetting.mockResolvedValue({ ok: true, value: null });
    mockUpsertSetting.mockResolvedValue({ ok: true, value: { caseManagement: false, caseCreationPolicy: 'manual' } });

    const result = await setTenantCapabilities('tenant-1', { caseManagement: false });

    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual({ inbox: true, caseManagement: false, caseCreationPolicy: 'manual' });
    expect(mockUpsertSetting).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      key: 'capabilities',
      value: { caseManagement: false, caseCreationPolicy: 'manual' },
    });

    // Segundo round-trip: lê o valor persistido e altera apenas a policy.
    mockGetSetting.mockResolvedValue({ ok: true, value: { caseManagement: false, caseCreationPolicy: 'manual' } });
    mockUpsertSetting.mockResolvedValue({ ok: true, value: { caseManagement: false, caseCreationPolicy: 'suggest' } });

    const second = await setTenantCapabilities('tenant-1', { caseCreationPolicy: 'suggest' });

    expect(second.ok).toBe(true);
    expect(second.capabilities).toEqual({ inbox: true, caseManagement: false, caseCreationPolicy: 'suggest' });
  });

  test('rejeita chaves desconhecidas', async () => {
    const result = await setTenantCapabilities('tenant-1', { unknownFlag: true });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
    expect(mockUpsertSetting).not.toHaveBeenCalled();
  });

  test('rejeita caseCreationPolicy inválido', async () => {
    const result = await setTenantCapabilities('tenant-1', { caseCreationPolicy: 'auto-pilot' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
    expect(mockUpsertSetting).not.toHaveBeenCalled();
  });

  test('rejeita caseManagement não boolean', async () => {
    const result = await setTenantCapabilities('tenant-1', { caseManagement: 'yes' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
    expect(mockUpsertSetting).not.toHaveBeenCalled();
  });

  test('inbox é sempre true nesta fase', async () => {
    const result = await setTenantCapabilities('tenant-1', { inbox: false });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  test('falha de DB no upsert gera erro explícito', async () => {
    mockGetSetting.mockResolvedValue({ ok: true, value: null });
    mockUpsertSetting.mockResolvedValue({ ok: false, error: 'db_error', details: 'boom' });

    await expect(setTenantCapabilities('tenant-1', { caseManagement: true })).rejects.toMatchObject({
      code: 'capabilities_db_error',
    });
  });
});

describe('pbxRecordingPolicyService', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('normalizePolicy aplica defaults e limites', () => {
    const svc = require('../../api/services/pbx/pbxRecordingPolicyService');
    const out = svc.normalizePolicy({
      enabled: true,
      retentionDays: 0,
      maskPhoneNumbers: false,
      requireConsent: true,
    });
    expect(out.enabled).toBe(true);
    expect(out.retentionDays).toBe(1);
    expect(out.maskPhoneNumbers).toBe(false);
    expect(out.requireConsent).toBe(true);
  });

  test('getRecordingPolicy retorna estrutura normalizada', async () => {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: { enabled: true, retentionDays: 15 } })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));
    const svc = require('../../api/services/pbx/pbxRecordingPolicyService');
    const out = await svc.getRecordingPolicy({ tenantKey: 't1' });
    expect(out.ok).toBe(true);
    expect(out.policy.enabled).toBe(true);
    expect(out.policy.retentionDays).toBe(15);
    expect(typeof out.policy.maskPhoneNumbers).toBe('boolean');
  });
});

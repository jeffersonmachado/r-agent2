'use strict';

/**
 * Coercion-guard tests for slaService.js
 * Verifies hostile toString() on policy fields don't crash the service.
 */

jest.mock('../../api/services/tenantSettingsService', () => ({
  getSetting: jest.fn(async () => ({ ok: true, value: null })),
  upsertSetting: jest.fn(async () => ({ ok: true, value: null })),
}));

const { upsertPolicy, listPolicies } = require('../../api/services/slaService');
const { getSetting, upsertSetting } = require('../../api/services/tenantSettingsService');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('slaService – coercion guards', () => {
  beforeEach(() => {
    getSetting.mockResolvedValue({ ok: true, value: null });
    upsertSetting.mockResolvedValue({ ok: true, value: null });
  });

  test('upsertPolicy: hostile id does not throw', async () => {
    const result = await upsertPolicy('t1', { id: hostileToString(), name: 'SLA' });
    expect(result).toMatchObject({ ok: true });
  });

  test('upsertPolicy: hostile name/description/customerSegment do not throw', async () => {
    const result = await upsertPolicy('t1', {
      name: hostileToString(),
      description: hostileToString(),
      customerSegment: hostileToString(),
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.policy.name).toBe('');
    expect(result.policy.customerSegment).toBe('default');
  });

  test('listPolicies: policies with hostile fields normalize safely', async () => {
    const { getSetting } = require('../../api/services/tenantSettingsService');
    getSetting.mockResolvedValueOnce({
      ok: true,
      value: {
        policies: [{ id: hostileToString(), name: hostileToString() }],
        breaches: [],
      },
    });
    const result = await listPolicies('t1');
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.policies)).toBe(true);
  });
});

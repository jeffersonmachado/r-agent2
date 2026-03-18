'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('automationService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function buildMocks() {
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async ({ key }) => {
        if (key === 'automations') {
          return {
            ok: true,
            value: {
              automations: [
                {
                  id: 'auto-1',
                  name: 'Test Auto',
                  description: 'Test',
                  status: 'draft',
                  definition: {},
                  createdAt: '2026-03-18T10:00:00Z',
                  updatedAt: '2026-03-18T10:00:00Z',
                  publishedAt: null,
                  lastRunAt: null,
                  lastRunId: null,
                  lastRunStatus: null,
                },
              ],
            },
          };
        }
        return { ok: false, error: 'unknown_key' };
      }),
      upsertSetting: jest.fn(async ({ key, value }) => ({
        ok: true,
        value: value && value.automations ? value : { automations: [] },
      })),
    }));
  }

  test('upsertAutomation com input.id hostil não estoura e coerce para fallback', async () => {
    buildMocks();
    const { upsertAutomation } = require('../../api/services/automationService');
    const hostile = { toString() { throw new Error('boom-id-insert'); } };
    const result = await upsertAutomation('tenant-1', {
      id: hostile,
      name: 'New Auto',
      description: 'New Desc',
      status: 'draft',
      definition: {},
    });
    expect(result.ok).toBe(true);
    expect(result.automation).toEqual(expect.objectContaining({
      id: expect.any(String),
      name: 'New Auto',
      description: 'New Desc',
      status: 'draft',
    }));
  });

  test('upsertAutomation com input.name hostil é coercido com safeTrim', async () => {
    buildMocks();
    const { upsertAutomation } = require('../../api/services/automationService');
    const hostile = { toString() { throw new Error('boom-name-insert'); } };
    const result = await upsertAutomation('tenant-1', {
      id: 'auto-2',
      name: hostile,
      description: 'Desc',
      status: 'draft',
      definition: {},
    });
    expect(result.ok).toBe(true);
    expect(result.automation).toEqual(expect.objectContaining({
      id: 'auto-2',
      name: '',
      description: 'Desc',
      status: 'draft',
    }));
  });

  test('publishAutomation com automationId hostil é coercido com safeToString', async () => {
    buildMocks();
    const { publishAutomation } = require('../../api/services/automationService');
    const hostile = { toString() { throw new Error('boom-id-publish'); } };
    const result = await publishAutomation('tenant-1', hostile);
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: 'not_found',
    }));
  });

  test('runAutomation com automationId hostil é coercido com safeToString', async () => {
    buildMocks();
    const { runAutomation } = require('../../api/services/automationService');
    const hostile = { toString() { throw new Error('boom-id-run'); } };
    const result = await runAutomation('tenant-1', hostile);
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: 'not_found',
    }));
  });
});

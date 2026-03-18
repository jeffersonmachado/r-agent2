'use strict';

const fs = require('fs');
const path = require('path');

describe('pbxExtensionsService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('bulkUpsertExtensions tolerates hostile error getters from upsert failures', async () => {
    const hostileError = {
      get code() {
        throw new Error('poisoned code getter');
      },
      get message() {
        throw new Error('poisoned message getter');
      },
      get details() {
        throw new Error('poisoned details getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/db/models', () => ({
      PbxTenant: jest.fn(() => ({
        findOne: jest.fn(async () => {
          throw hostileError;
        }),
      })),
    }));

    const { bulkUpsertExtensions } = require('../../api/services/pbx/pbxExtensionsService');

    const out = await bulkUpsertExtensions({
      tenantKey: 'tenant-1',
      items: [{ extension: '1001', displayName: 'Ramal 1001' }],
      actorUserId: 'agent-1',
    });

    expect(out.ok).toBe(false);
    expect(out.successCount).toBe(0);
    expect(out.errorCount).toBe(1);
    expect(out.errors[0]).toEqual({
      ok: false,
      error: 'bulk_upsert_failed',
      details: null,
      payload: { extension: '1001', displayName: 'Ramal 1001' },
    });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/pbx/pbxExtensionsService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});

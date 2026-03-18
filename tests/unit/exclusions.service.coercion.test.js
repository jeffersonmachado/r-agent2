'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('exclusions.service coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeHostileError() {
    const err = {};
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('boom-message-getter');
      },
    });
    Object.defineProperty(err, 'toString', {
      get() {
        throw new Error('boom-tostring-getter');
      },
    });
    return err;
  }

  test('loadTenantExclusions tolera err.message hostil e retorna []', async () => {
    const hostileError = makeHostileError();

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));

    jest.doMock('../../api/db/models', () => ({
      TenantExclusion: jest.fn(() => ({
        findAll: jest.fn(async () => {
          throw hostileError;
        }),
      })),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '' })),
    }));

    const { loadTenantExclusions } = require('../../api/services/exclusions.service');
    await expect(loadTenantExclusions('tenant-1')).resolves.toEqual([]);
  });

  test('persistNewTenantExclusions tolera err.message hostil e nao estoura', async () => {
    const hostileError = makeHostileError();

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));

    jest.doMock('../../api/db/models', () => ({
      TenantExclusion: jest.fn(() => ({
        count: jest.fn(async () => {
          throw hostileError;
        }),
        bulkCreate: jest.fn(async () => ({ ok: true })),
        create: jest.fn(async () => ({ ok: true })),
      })),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '' })),
    }));

    const { persistNewTenantExclusions } = require('../../api/services/exclusions.service');

    const out = await persistNewTenantExclusions('tenant-1', [], ['artefato_ocr_token']);
    expect(out).toEqual({ persisted: 0, skipped: 1 });
  });

  test('inferExclusions tolera err.message hostil no provider de IA', async () => {
    const hostileError = makeHostileError();

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => null),
    }));

    jest.doMock('../../api/db/models', () => ({
      TenantExclusion: jest.fn(),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => {
        throw hostileError;
      }),
    }));

    const { inferExclusions } = require('../../api/services/exclusions.service');
    const out = await inferExclusions('contexto com ruido', 'tenant-1');
    expect(out).toEqual([]);
  });

  test('static guard: service nao deve usar return err.message || String(err)', () => {
    const servicePath = path.join(__dirname, '../../api/services/exclusions.service.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)/);
    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*safeString\(err/);
  });
});

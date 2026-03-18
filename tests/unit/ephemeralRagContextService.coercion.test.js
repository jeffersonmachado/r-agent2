'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ephemeralRagContextService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('upsertEphemeralContext tolerates hostile error.message getter while reading existing context', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const redis = {
      status: 'ready',
      get: jest.fn(async () => {
        throw hostileError;
      }),
      set: jest.fn(async () => 'OK'),
    };

    jest.doMock('../../infra/redis/ephemeralContextClient', () => ({
      getEphemeralContextClient: jest.fn(() => redis),
    }));

    const logger = require('../../api/utils/logger');
    const { upsertEphemeralContext } = require('../../api/services/ephemeralRagContextService');

    const out = await upsertEphemeralContext({
      tenantId: 'tenant-1',
      executionId: 'exec-1',
      chunks: [{ sourceType: 'uploaded_file', sourceId: 'doc-1', text: 'texto de exemplo suficientemente longo para passar no filtro minimo.' }],
    });

    expect(out.ok).toBe(true);
    expect(out.used).toBe('redis');
    expect(logger.warn).toHaveBeenCalledWith(
      '[EphemeralContext] Falha ao ler contexto existente, sobrescrevendo',
      expect.objectContaining({ tenantId: 'tenant-1', executionId: 'exec-1', error: '' })
    );
  });

  test('upsertEphemeralContext falls back to memory when redis.set throws hostile error getter', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const redis = {
      status: 'ready',
      get: jest.fn(async () => null),
      set: jest.fn(async () => {
        throw hostileError;
      }),
    };

    jest.doMock('../../infra/redis/ephemeralContextClient', () => ({
      getEphemeralContextClient: jest.fn(() => redis),
    }));

    const logger = require('../../api/utils/logger');
    const { upsertEphemeralContext } = require('../../api/services/ephemeralRagContextService');

    const out = await upsertEphemeralContext({
      tenantId: 'tenant-1',
      executionId: 'exec-2',
      chunks: [{ sourceType: 'uploaded_file', sourceId: 'doc-2', text: 'outro texto suficientemente longo para passar no filtro minimo.' }],
    });

    expect(out.ok).toBe(true);
    expect(out.used).toBe('memory');
    expect(logger.warn).toHaveBeenCalledWith(
      '[EphemeralContext] Falha ao persistir no Redis, usando fallback memória',
      expect.objectContaining({ tenantId: 'tenant-1', executionId: 'exec-2', error: '' })
    );
  });

  test('getEphemeralContext handles hostile redis.get error without throwing', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const redis = {
      status: 'ready',
      get: jest.fn(async () => {
        throw hostileError;
      }),
    };

    jest.doMock('../../infra/redis/ephemeralContextClient', () => ({
      getEphemeralContextClient: jest.fn(() => redis),
    }));

    const logger = require('../../api/utils/logger');
    const { getEphemeralContext } = require('../../api/services/ephemeralRagContextService');

    const out = await getEphemeralContext({ tenantId: 'tenant-1', executionId: 'exec-3' });
    expect(out).toEqual({ ok: true, found: false, chunks: [], used: 'redis' });
    expect(logger.warn).toHaveBeenCalledWith(
      '[EphemeralContext] Falha ao recuperar contexto',
      expect.objectContaining({ tenantId: 'tenant-1', executionId: 'exec-3', error: '' })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ephemeralRagContextService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});

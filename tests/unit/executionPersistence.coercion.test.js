'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('executionPersistence coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('persistExecution logs hostile error safely and rethrows original error', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const create = jest.fn(async () => {
      throw hostileError;
    });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({
        findByPk: jest.fn(async () => null),
        create,
      }),
    }));

    const logger = require('../../api/utils/logger');
    const { persistExecution } = require('../../api/services/executionPersistence');

    await expect(persistExecution({
      executionId: 'exec-1',
      status: 'approved',
      payload: { name: 'x', description: 'y', useRag: false },
      decisionAuthority: null,
      abstentionReason: null,
      evidenceContext: null,
      stages: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })).rejects.toBe(hostileError);

    expect(logger.error).toHaveBeenCalledWith(
      '[executionPersistence] Erro ao persistir execução',
      expect.objectContaining({ executionId: 'exec-1', error: '' })
    );
  });

  test('retrieveExecution returns null when findByPk throws hostile error getter', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({
        findByPk: jest.fn(async () => {
          throw hostileError;
        }),
      }),
    }));

    const logger = require('../../api/utils/logger');
    const { retrieveExecution } = require('../../api/services/executionPersistence');

    const out = await retrieveExecution('exec-2');
    expect(out).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      '[executionPersistence] Erro ao recuperar execução (PostgreSQL)',
      expect.objectContaining({ executionId: 'exec-2', error: '' })
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/executionPersistence.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});

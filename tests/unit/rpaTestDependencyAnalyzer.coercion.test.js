'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('rpaTestDependencyAnalyzer coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('analyzeFlowDependencies tolerates hostile fs error.message getter while loading existing data', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('fs', () => {
      const realFs = jest.requireActual('fs');
      return {
        ...realFs,
        existsSync: jest.fn(() => {
          throw hostileError;
        }),
        readFileSync: jest.fn(() => '{}'),
      };
    });

    const logger = require('../../api/utils/logger');
    const { analyzeFlowDependencies } = require('../../api/services/rpaTestDependencyAnalyzer');

    const out = await analyzeFlowDependencies({ id: 'f1', name: 'Fluxo', nodes: [{ type: 'start' }, { type: 'end' }] }, 'tenant-1');

    expect(out).toEqual(expect.objectContaining({
      flow: expect.objectContaining({ flowId: 'f1' }),
      cadastros: expect.any(Object),
      rag: expect.any(Object),
    }));
    expect(logger.error).toHaveBeenCalledWith('Erro ao carregar dados existentes', { error: '' });
  });

  test('resolveDependencies handles hostile getter failures without cascading crashes', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const badSeedInfo = {
      seedName: 'seed-platform-create-queue',
      get dependencyType() {
        throw hostileError;
      },
      target: 'queue-a',
    };

    process.env.RPA_DEPENDENCY_EXECUTION = 'false';
    const logger = require('../../api/utils/logger');
    const { resolveDependencies } = require('../../api/services/rpaTestDependencyAnalyzer');

    const out = await resolveDependencies({
      seeds: {
        available: ['seed-platform-create-queue'],
        missing: [badSeedInfo],
      },
    }, 'tenant-1');

    expect(out.success).toBe(false);
    expect(out.failedSeeds[0]).toEqual(expect.objectContaining({
      seedName: 'seed-platform-create-queue',
      reason: '',
    }));
    expect(out.errors[0]).toEqual(expect.objectContaining({
      seedName: 'seed-platform-create-queue',
      error: '',
    }));
    expect(logger.error).toHaveBeenCalledWith('Erro ao executar seed', {
      seedName: 'seed-platform-create-queue',
      error: '',
    });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/rpaTestDependencyAnalyzer.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});

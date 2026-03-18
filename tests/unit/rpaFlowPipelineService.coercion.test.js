'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('rpaFlowPipelineService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function hostileError() {
    const err = {};
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('hostile message getter');
      },
    });
    err.toString = () => {
      throw new Error('hostile toString');
    };
    return err;
  }

  function mockBaseDeps({ resolveDependenciesImpl, executeRecordingImpl } = {}) {
    jest.doMock('../../engine/rpaDependencyResolver', () => ({
      resolveDependencies: jest.fn(resolveDependenciesImpl || (async () => ({
        allSatisfied: true,
        missingDependencies: [],
        requiredSeeds: [],
        snapshot: {},
      }))),
    }));

    jest.doMock('../../engine/flowToRpaConverter', () => ({
      convertFlowToRpaRecording: jest.fn(() => ({
        id: 'rec-1',
        name: 'Recording 1',
        steps: [],
        metadata: {},
      })),
    }));

    jest.doMock('../../api/services/rpaService', () => ({
      listRecordings: jest.fn(() => [{ id: 'seed-a', name: 'seed-a' }]),
      executeRecording: jest.fn(executeRecordingImpl || (async () => ({ success: true }))),
    }));

    jest.doMock('../../lib/replaySystem', () => ({
      ReplaySystem: jest.fn().mockImplementation(() => ({
        start: jest.fn(),
        recordEvent: jest.fn(),
        recordAction: jest.fn(),
        recordError: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'replays/mock.json'),
      })),
    }));

    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: jest.fn().mockImplementation(() => ({
        start: jest.fn(),
        recordAction: jest.fn(),
        recordCustom: jest.fn(),
        stop: jest.fn(),
        save: jest.fn(() => 'recordings/mock.json'),
      })),
    }));

    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
    }));

    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
    }));
  }

  test('executeRpaFlowPipeline nao quebra com erro hostil no catch principal', async () => {
    mockBaseDeps({
      resolveDependenciesImpl: async () => {
        throw hostileError();
      },
    });

    const { executeRpaFlowPipeline } = require('../../api/services/rpaFlowPipelineService');

    const out = await executeRpaFlowPipeline({
      id: 'flow-1',
      tenantId: 'tenant-1',
      name: 'Flow 1',
    });

    expect(out.success).toBe(false);
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(typeof out.errors[0]).toBe('string');
  });

  test('executeRpaFlowPipeline nao quebra com erro hostil ao executar seed', async () => {
    mockBaseDeps({
      resolveDependenciesImpl: async () => ({
        allSatisfied: false,
        missingDependencies: [{ identifier: 'dep-1' }],
        requiredSeeds: ['seed-a'],
        snapshot: {},
      }),
      executeRecordingImpl: async () => {
        throw hostileError();
      },
    });

    const { executeRpaFlowPipeline } = require('../../api/services/rpaFlowPipelineService');

    const out = await executeRpaFlowPipeline(
      {
        id: 'flow-2',
        tenantId: 'tenant-1',
        name: 'Flow 2',
      },
      {
        autoExecuteSeeds: true,
        saveRecording: false,
      }
    );

    expect(out.success).toBe(false);
    expect(out.errors.some((e) => typeof e === 'string')).toBe(true);
  });

  test('arquivo nao deve ter err/error.message diretos fora do helper', () => {
    const fs = jest.requireActual('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaFlowPipelineService.js'),
      'utf-8'
    );

    const offenders = [];
    for (const line of content.split('\n')) {
      if (!/\b(err|error)\.message\b/.test(line)) continue;
      if (line.includes('safeToString(err.message')) continue;
      offenders.push(line.trim());
    }

    expect(offenders).toEqual([]);
  });
});

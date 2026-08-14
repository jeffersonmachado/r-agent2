'use strict';

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getAllExecutions: jest.fn(),
  getMeshHistory: jest.fn(),
}));

describe('qaWavesExecutionService — histórico persistido (meshHistory)', () => {
  let runtimeRoot;
  let qaMeshService;
  let qaWavesExecutionService;

  beforeEach(() => {
    jest.resetModules();
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-hist-'));
    configureRuntimeRoot(runtimeRoot);

    jest.isolateModules(() => {
      qaMeshService = require('../qaMeshService');
      qaWavesExecutionService = require('../qaWavesExecutionService');
    });

    qaMeshService.getAllExecutions.mockReturnValue([]);
    qaMeshService.getMeshHistory.mockReturnValue([]);
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('retorna execuções persistidas em disco quando a memória está vazia (pós-restart)', () => {
    qaMeshService.getMeshHistory.mockReturnValue([
      {
        executionId: 'mesh-hist-1',
        executionOrigin: 'qa_waves_real',
        finishedAt: '2026-07-30T20:00:00.000Z',
        summary: { goNoGo: 'GO' },
        historyPath: '/srv/ragent2/private/history.json',
        evidenceDir: '/srv/ragent2/private/evidence',
        results: [{ artifacts: [{ type: 'replay', path: '/srv/ragent2/private/replay.json' }] }],
      },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(20);

    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe('mesh-hist-1');
    expect(result[0].replayArtifacts).toEqual([]);
    expect(JSON.stringify(result[0])).not.toContain('/srv/ragent2/private');
    expect(result[0]).not.toHaveProperty('historyPath');
    expect(result[0]).not.toHaveProperty('evidenceDir');
  });

  test('ignora execuções persistidas de outras origens (scheduler, pipeline)', () => {
    qaMeshService.getMeshHistory.mockReturnValue([
      { executionId: 'mesh-hist-sched', executionOrigin: 'scheduler', finishedAt: '2026-07-30T20:00:00.000Z' },
      { executionId: 'mesh-hist-pipe', executionOrigin: 'pipeline', isCanonicalExecution: true, finishedAt: '2026-07-30T21:00:00.000Z' },
    ]);

    expect(qaWavesExecutionService.listWaveExecutions(20)).toHaveLength(0);
  });

  test('deduplica executionId presente na memória e no disco, preferindo o registro vivo', () => {
    qaMeshService.getAllExecutions.mockReturnValue([
      {
        executionId: 'mesh-both',
        createdAt: '2026-07-30T22:00:00.000Z',
        payload: { executionOrigin: 'qa_waves_real' },
      },
    ]);
    qaMeshService.getMeshHistory.mockReturnValue([
      { executionId: 'mesh-both', executionOrigin: 'qa_waves_real', finishedAt: '2026-07-30T22:00:00.000Z' },
      { executionId: 'mesh-old', executionOrigin: 'qa_waves_real', finishedAt: '2026-07-30T19:00:00.000Z' },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(20);

    expect(result.map((item) => item.executionId)).toEqual(['mesh-both', 'mesh-old']);
  });

  test('ordena por mais recente e aplica o limit após o merge', () => {
    qaMeshService.getAllExecutions.mockReturnValue([
      { executionId: 'live-1', createdAt: '2026-07-30T18:00:00.000Z', payload: { executionOrigin: 'qa_waves_real' } },
    ]);
    qaMeshService.getMeshHistory.mockReturnValue([
      { executionId: 'hist-new', executionOrigin: 'qa_waves_real', finishedAt: '2026-07-30T23:00:00.000Z' },
      { executionId: 'hist-old', executionOrigin: 'qa_waves_real', finishedAt: '2026-07-30T17:00:00.000Z' },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(2);

    expect(result.map((item) => item.executionId)).toEqual(['hist-new', 'live-1']);
  });

  test('não mistura execuções vivas ou persistidas de tenants diferentes', () => {
    qaMeshService.getAllExecutions.mockReturnValue([
      {
        executionId: 'live-a',
        tenantId: 'tenant-a',
        createdAt: '2026-07-30T20:00:00.000Z',
        payload: { executionOrigin: 'qa_waves_real', tenantId: 'tenant-a' },
      },
      {
        executionId: 'live-b',
        tenantId: 'tenant-b',
        createdAt: '2026-07-30T21:00:00.000Z',
        payload: { executionOrigin: 'qa_waves_real', tenantId: 'tenant-b' },
      },
    ]);
    qaMeshService.getMeshHistory.mockReturnValue([
      { executionId: 'hist-a', tenantId: 'tenant-a', executionOrigin: 'qa_waves_real' },
      { executionId: 'hist-b', tenantId: 'tenant-b', executionOrigin: 'qa_waves_real' },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(20, 'tenant-a');

    expect(result.map((item) => item.executionId).sort()).toEqual(['hist-a', 'live-a']);
    expect(qaMeshService.getAllExecutions).toHaveBeenCalledWith(20, { tenantId: 'tenant-a' });
    expect(qaMeshService.getMeshHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
  });
});

'use strict';

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
    process.env.RUNTIME_ROOT = runtimeRoot;

    jest.isolateModules(() => {
      qaMeshService = require('../qaMeshService');
      qaWavesExecutionService = require('../qaWavesExecutionService');
    });

    qaMeshService.getAllExecutions.mockReturnValue([]);
    qaMeshService.getMeshHistory.mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env.RUNTIME_ROOT;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('retorna execuções persistidas em disco quando a memória está vazia (pós-restart)', () => {
    qaMeshService.getMeshHistory.mockReturnValue([
      {
        executionId: 'mesh-hist-1',
        executionOrigin: 'qa_waves_real',
        finishedAt: '2026-07-30T20:00:00.000Z',
        summary: { goNoGo: 'GO' },
      },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(20);

    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe('mesh-hist-1');
    expect(result[0].replayArtifacts).toEqual([]);
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
});

'use strict';

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getAllExecutions: jest.fn(),
}));

describe('qaWavesExecutionService', () => {
  let runtimeRoot;
  let qaMeshService;
  let qaWavesExecutionService;

  beforeEach(() => {
    jest.resetModules();
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-exec-'));
    configureRuntimeRoot(runtimeRoot);

    jest.isolateModules(() => {
      qaMeshService = require('../qaMeshService');
      qaWavesExecutionService = require('../qaWavesExecutionService');
    });
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('listWaveExecutions usa metadados do prefixo sem parse completo do replay', () => {
    const replayDir = path.join(runtimeRoot, 'rpa', 'replay');
    fs.mkdirSync(replayDir, { recursive: true });

    fs.writeFileSync(path.join(replayDir, 'replay-prefix-only.json'), [
      '{',
      '  "executionId": "exec-1",',
      '  "replayId": "replay-1",',
      '  "scenarioId": "scenario-1",',
      '  "seedId": "seed-1",',
      '  "status": "completed",',
      '  "finishedAt": "2026-04-27T18:00:00.000Z",',
      '  "logs": [INVALID_JSON_THAT_WOULD_BREAK_PARSE',
    ].join('\n'));

    qaMeshService.getAllExecutions.mockReturnValue([
      {
        executionId: 'exec-1',
        payload: { executionOrigin: 'qa_waves_real' },
      },
    ]);

    const result = qaWavesExecutionService.listWaveExecutions(5);

    expect(result).toHaveLength(1);
    expect(result[0].replayArtifacts).toEqual([
      {
        replayId: 'replay-1',
        waveId: null,
        journeyId: null,
        journeyStep: null,
        scenarioId: 'scenario-1',
        seedId: 'seed-1',
        status: 'completed',
        finishedAt: '2026-04-27T18:00:00.000Z',
        platformAdapter: null,
      },
    ]);
  });
});
'use strict';

const fs = require('fs');
const checkpointManager = require('../checkpoints/checkpointManager');

describe('checkpointManager', () => {
  test('cria e conclui wave com persistencia', () => {
    checkpointManager.ensureStateFiles();
    const wave = `WAVE-TEST-${Date.now()}`;

    checkpointManager.startWave({ wave, title: 'Teste persistencia' });
    checkpointManager.registerProgress({
      wave,
      changes: ['change-a'],
      filesCreated: ['qa/checkpoints/tmp-a.json'],
    });
    checkpointManager.registerValidation({
      wave,
      validation: {
        buildBackend: true,
        buildFrontend: true,
        qaTechnical: true,
        qaBusiness: true,
        replay: true,
      },
      metrics: {
        testsPassed: 2,
        testsFailed: 0,
      },
    });
    checkpointManager.completeWave({ wave, status: 'passed' });

    const data = checkpointManager.loadWave(wave);
    expect(data).toBeTruthy();
    expect(data.status).toBe('passed');
    expect(data.validation.buildBackend).toBe(true);
    expect(fs.existsSync(checkpointManager.paths.PROGRESS_PATH)).toBe(true);
  });
});

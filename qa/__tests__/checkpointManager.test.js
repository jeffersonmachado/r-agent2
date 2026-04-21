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

  test('normaliza falhas historicas supersedidas pelo ultimo checkpoint bem-sucedido', () => {
    const waves = [
      {
        wave: 'WAVE-2',
        status: 'failed',
        startedAt: '2026-04-07T15:48:29.995Z',
        finishedAt: '2026-04-07T15:48:29.996Z',
      },
      {
        wave: 'WAVE-MESH',
        status: 'passed',
        startedAt: '2026-04-08T17:33:27.499Z',
        finishedAt: '2026-04-08T18:25:13.096Z',
      },
    ];
    const progress = {
      currentWave: 'WAVE-MESH',
      completedWaves: ['WAVE-MESH'],
      failedWaves: ['WAVE-2'],
      globalStatus: 'blocked',
      lastSuccessfulCheckpoint: 'WAVE-MESH',
    };
    const failures = [
      {
        wave: 'WAVE-MESH',
        finishedAt: '2026-04-08T17:21:58.910Z',
        blockers: ['qa_mesh_no_go'],
      },
      {
        wave: 'WAVE-2',
        finishedAt: '2026-04-07T15:48:29.996Z',
        blockers: ['backend_build'],
      },
    ];

    const normalized = checkpointManager.normalizeFailures({ progress, failures, waves });

    expect(normalized).toEqual([]);
  });
});

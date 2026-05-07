'use strict';

const { convertExecutionToReplay } = require('../../api/services/qaWavesReplayAdapter');

describe('qaWavesReplayAdapter.convertExecutionToReplay', () => {
  test('converte execução em replay enriquecido com contexto de browser', () => {
    const execution = {
      replayId: 'qa_wave_replay_123',
      executionId: 'exec-123',
      waveId: 'wave-01',
      journeyId: 'journey-01',
      scenarioId: 'scenario-01',
      seedId: 'seed-01',
      startedAt: '2026-05-05T10:00:00.000Z',
      finishedAt: '2026-05-05T10:00:05.000Z',
      status: 'success',
      platformAdapter: 'qa_mesh',
      steps: [
        {
          id: 's1',
          index: 1,
          name: 'Abrir login',
          action: 'goto',
          selector: null,
          status: 'success',
          startedAt: '2026-05-05T10:00:00.000Z',
          finishedAt: '2026-05-05T10:00:01.000Z',
          screenshotAfter: 'data:image/png;base64,AAA',
        },
      ],
    };

    const browserSession = {
      browser: {
        name: 'chromium',
        version: '123.0',
        viewport: { width: 1280, height: 720 },
      },
      tracePath: '/tmp/trace.zip',
      traceWarning: null,
      rpaReplayPath: '/tmp/replay.json',
      steps: execution.steps,
    };

    const replay = convertExecutionToReplay(execution, browserSession);

    expect(replay).toEqual(expect.objectContaining({
      replayId: 'qa_wave_replay_123',
      source: 'qa-waves',
      executionId: 'exec-123',
      waveId: 'wave-01',
      journeyId: 'journey-01',
      scenarioId: 'scenario-01',
      seedId: 'seed-01',
      status: 'success',
      tracePath: '/tmp/trace.zip',
      browser: {
        name: 'chromium',
        version: '123.0',
        viewport: { width: 1280, height: 720 },
      },
    }));

    expect(Array.isArray(replay.steps)).toBe(true);
    expect(replay.steps[0]).toEqual(expect.objectContaining({
      id: 's1',
      index: 1,
      name: 'Abrir login',
      action: 'goto',
      status: 'success',
      screenshotAfter: 'data:image/png;base64,AAA',
    }));

    expect(replay.metadata).toEqual(expect.objectContaining({
      platformAdapter: 'qa_mesh',
      rpaReplayPath: '/tmp/replay.json',
    }));
  });

  test('normaliza status de erro e agrega erros por step', () => {
    const execution = {
      id: 'fallback-replay-id',
      status: 'error',
      errors: [{ message: 'falha global' }],
      steps: [
        {
          id: 's1',
          type: 'click',
          success: false,
          error: 'botão não encontrado',
          timestamp: '2026-05-05T10:00:00.000Z',
        },
      ],
    };

    const replay = convertExecutionToReplay(execution, {});

    expect(replay.status).toBe('failed');
    expect(replay.steps[0]).toEqual(expect.objectContaining({
      action: 'click',
      status: 'failed',
      error: expect.objectContaining({
        message: 'botão não encontrado',
      }),
    }));

    expect(replay.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'falha global' }),
      expect.objectContaining({ stepId: 's1', message: 'botão não encontrado' }),
    ]));
  });
});

'use strict';

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getAllExecutions: jest.fn(),
}));

describe('qaWavesExecutionService.buildUiTrace', () => {
  let runtimeRoot;
  let qaWavesExecutionService;

  beforeEach(() => {
    jest.resetModules();
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-uitrace-'));
    configureRuntimeRoot(runtimeRoot);

    jest.isolateModules(() => {
      qaWavesExecutionService = require('../qaWavesExecutionService');
    });
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  function makePng(filePath) {
    fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a', 'hex'));
  }

  test('retorna [] quando não há steps RPA ricos', () => {
    expect(qaWavesExecutionService.buildUiTrace(null)).toEqual([]);
    expect(qaWavesExecutionService.buildUiTrace({})).toEqual([]);
    expect(qaWavesExecutionService.buildUiTrace({ rawStatus: { results: { steps: [] } } })).toEqual([]);
  });

  test('mapeia ações de UI com screenshots ANTES/DEPOIS como data URI', () => {
    const shotBefore = path.join(runtimeRoot, 'before-step-1.png');
    const shotAfter = path.join(runtimeRoot, 'after-step-1.png');
    makePng(shotBefore);
    makePng(shotAfter);

    const result = {
      rawStatus: {
        results: {
          steps: [
            {
              id: 'step-1',
              name: 'Preencher busca de replay',
              action: 'fill',
              selector: 'input[placeholder*="Nome"]',
              input: 'qa_wave_replay',
              status: 'success',
              success: true,
              startedAt: '2026-07-22T15:00:00.000Z',
              finishedAt: '2026-07-22T15:00:02.000Z',
              durationMs: 2000,
              screenshotBefore: shotBefore,
              screenshotAfter: shotAfter,
              networkEvents: [{ url: '/api/test-executions/replays' }],
            },
          ],
        },
      },
    };

    const trace = qaWavesExecutionService.buildUiTrace(result);
    expect(trace).toHaveLength(1);
    const step = trace[0];
    expect(step.id).toBe('step-1');
    expect(step.index).toBe(1);
    expect(step.action).toBe('fill');
    expect(step.selector).toContain('placeholder');
    expect(step.input).toBe('qa_wave_replay');
    expect(step.status).toBe('success');
    expect(step.screenshotBefore).toMatch(/^data:image\/png;base64,/);
    expect(step.screenshotAfter).toMatch(/^data:image\/png;base64,/);
    expect(step.networkEvents).toHaveLength(1);
  });

  test('screenshot ausente ou inexistente vira null sem quebrar o trace', () => {
    const result = {
      rawStatus: {
        results: {
          steps: [
            {
              name: 'Navegar',
              action: 'navigate',
              success: true,
              screenshotBefore: path.join(runtimeRoot, 'nao-existe.png'),
              screenshotAfter: null,
            },
          ],
        },
      },
    };

    const trace = qaWavesExecutionService.buildUiTrace(result);
    expect(trace).toHaveLength(1);
    expect(trace[0].screenshotBefore).toBeNull();
    expect(trace[0].screenshotAfter).toBeNull();
    expect(trace[0].action).toBe('navigate');
  });

  test('screenshot acima do limite de tamanho é descartado', () => {
    const bigShot = path.join(runtimeRoot, 'big.png');
    fs.writeFileSync(bigShot, Buffer.alloc(901 * 1024, 1));

    const result = {
      rawStatus: {
        results: {
          steps: [
            { name: 'Passo', action: 'assert', success: true, screenshotAfter: bigShot },
          ],
        },
      },
    };

    const trace = qaWavesExecutionService.buildUiTrace(result);
    expect(trace[0].screenshotAfter).toBeNull();
  });
});

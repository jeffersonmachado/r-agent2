'use strict';

jest.mock('../../core/rpa/utils/autoLoginFlow', () => ({
  autoLoginBeforeSteps: jest.fn(async () => ({ success: true, loggedIn: false })),
}));

const { RpaTestRunner } = require('../../core/rpa/rpaTestRunner');

describe('RPA reliability contract', () => {
  function buildRunnerWithMockedExecutor(executeActionMock) {
    const runner = new RpaTestRunner({
      enableReplay: false,
      headless: true,
    });

    runner.executor = {
      page: null,
      executeAction: executeActionMock,
      captureScreenshot: jest.fn(async () => null),
      getErrors: jest.fn(() => []),
      getScreenshots: jest.fn(() => []),
      getConsoleLogs: jest.fn(() => []),
      getDebugLogs: jest.fn(() => []),
      getHttpErrors: jest.fn(() => []),
      getReliabilityMetrics: jest.fn(() => ({ retryRate: 0.5, recoverySuccessRate: 1 })),
    };

    return runner;
  }

  test('propaga finalDecision/bugResolution/reliabilityMetrics em execucao com recovery', async () => {
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({
        success: true,
        finalDecision: 'PASS_WITH_RETRY',
        bugResolution: {
          classification: { type: 'SELECTOR_NOT_FOUND' },
          owner: 'AUTOMATION',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        finalDecision: 'PASS_WITH_RECOVERY',
        bugResolution: {
          classification: { type: 'ASSERTION_FAILED' },
          owner: 'AUTOMATION',
        },
      });

    const runner = buildRunnerWithMockedExecutor(executeAction);

    const recording = {
      id: 'recording-contract-success',
      name: 'contract-success',
      version: '1.0.0',
      data: {},
      steps: [
        { type: 'wait', condition: 1, critical: false },
        { type: 'wait', condition: 1, critical: false },
      ],
    };

    const out = await runner.playback(recording, {});

    expect(out.success).toBe(true);
    expect(out.finalDecision).toBe('PASS_WITH_RECOVERY');
    expect(out.reliabilityMetrics).toEqual(
      expect.objectContaining({ retryRate: 0.5, recoverySuccessRate: 1 }),
    );
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]).toEqual(
      expect.objectContaining({
        finalDecision: 'PASS_WITH_RETRY',
        bugResolution: expect.objectContaining({ owner: 'AUTOMATION' }),
      }),
    );
    expect(out.steps[1]).toEqual(
      expect.objectContaining({
        finalDecision: 'PASS_WITH_RECOVERY',
        bugResolution: expect.objectContaining({ owner: 'AUTOMATION' }),
      }),
    );
  });

  test('propaga falha tipada como finalDecision final da execucao', async () => {
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'element not found',
        finalDecision: 'FAIL_AUTOMATION_BUG',
        bugResolution: {
          classification: { type: 'SELECTOR_NOT_FOUND' },
          owner: 'AUTOMATION',
        },
      });

    const runner = buildRunnerWithMockedExecutor(executeAction);

    const recording = {
      id: 'recording-contract-failure',
      name: 'contract-failure',
      version: '1.0.0',
      data: {},
      steps: [
        { type: 'click', selector: '.missing-button' },
      ],
    };

    const out = await runner.playback(recording, {});

    expect(out.success).toBe(false);
    expect(out.finalDecision).toBe('FAIL_AUTOMATION_BUG');
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toEqual(
      expect.objectContaining({
        success: false,
        finalDecision: 'FAIL_AUTOMATION_BUG',
        bugResolution: expect.objectContaining({ owner: 'AUTOMATION' }),
      }),
    );
  });
});

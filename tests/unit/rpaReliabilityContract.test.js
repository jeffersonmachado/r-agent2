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

  test('falha em step não-crítico vira warning e não derruba a execução', async () => {
    // Regressão: um wait soft de toast efêmero que expirava sob contenção
    // marcava results.success=false e derrubava o cenário do QA mesh para
    // infra_error, mesmo com todos os landmarks críticos passando.
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'timeout esperando toast efêmero' })
      .mockResolvedValueOnce({ success: true });

    const runner = buildRunnerWithMockedExecutor(executeAction);

    const recording = {
      id: 'recording-non-critical-failure',
      name: 'non-critical-failure',
      version: '1.0.0',
      data: {},
      steps: [
        { type: 'click', selector: '.submit' },
        { type: 'wait', selector: '.rap-toast--success', critical: false },
        { type: 'assert', selector: '.landmark-persistente' },
      ],
    };

    const out = await runner.playback(recording, {});

    expect(out.success).toBe(true);
    expect(out.errors).toHaveLength(0);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toEqual(
      expect.objectContaining({
        step: 2,
        action: 'wait',
        severity: 'non_critical_step_failure',
      }),
    );
    expect(out.steps).toHaveLength(3);
    expect(out.steps[1].success).toBe(false);
    expect(executeAction).toHaveBeenCalledTimes(3);
  });

  test('falha em step crítico interrompe a execução e marca erro', async () => {
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'element not found' })
      .mockResolvedValueOnce({ success: true });

    const runner = buildRunnerWithMockedExecutor(executeAction);

    const recording = {
      id: 'recording-critical-failure',
      name: 'critical-failure',
      version: '1.0.0',
      data: {},
      steps: [
        { type: 'click', selector: '.missing-button' },
        { type: 'click', selector: '.never-reached' },
      ],
    };

    const out = await runner.playback(recording, {});

    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    expect(out.warnings).toHaveLength(0);
    expect(out.steps).toHaveLength(1);
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  test('step sem flag critical é tratado como crítico (fail-closed)', async () => {
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'boom' });

    const runner = buildRunnerWithMockedExecutor(executeAction);

    const recording = {
      id: 'recording-default-critical',
      name: 'default-critical',
      version: '1.0.0',
      data: {},
      steps: [{ type: 'wait', selector: '.x' }],
    };

    const out = await runner.playback(recording, {});

    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
  });
});

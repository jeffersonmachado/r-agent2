'use strict';

const {
  collectCriticalFailures,
  shouldRunAutoCorrection,
  generateSummary,
  JourneyRecorder,
} = require('../../scripts/workspace-core-smoke');

describe('workspace-core governance semantics', () => {
  function baseChecks(overrides = {}) {
    return {
      entityCreated: true,
      linksCreated: true,
      timelineConsistent: true,
      timelineContainsTicket: true,
      timelineContainsTask: true,
      insightCreated: true,
      actionCreated: true,
      replayGenerated: true,
      ...overrides,
    };
  }

  test('modo real aprovado não inclui failureInjection', () => {
    const summary = generateSummary({
      mode: 'real',
      checks: baseChecks(),
      errors: [],
      artifacts: {},
      records: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      tenantId: 't-1',
      entityId: 'e-1',
      failureInjection: null,
      autocorrection: { required: false, created: false, reason: 'ok' },
    });

    expect(summary.status).toBe('passed');
    expect(summary.failureInjection).toBeUndefined();
    expect(summary.failureType).toBe('none');
    expect(summary.autocorrection).toEqual({ required: false, created: false, reason: 'ok' });
    expect(summary.governance?.decision).toBe('GO');
  });

  test('modo real falha quando checks críticos falham', () => {
    const checks = baseChecks({ timelineContainsTask: false });
    const summary = generateSummary({
      mode: 'real',
      checks,
      errors: [],
      artifacts: {},
      records: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      tenantId: 't-1',
      entityId: 'e-1',
      failureInjection: null,
      autocorrection: { required: true, created: true, reason: 'created' },
    });

    expect(collectCriticalFailures(checks)).toContain('timelineContainsTask');
    expect(summary.status).toBe('failed');
    expect(summary.failureType).toBe('critical_checks_failed');
    expect(summary.governance?.decision).toBe('NO_GO');
  });

  test('modo failure passa quando falha simulada foi tratada', () => {
    const summary = generateSummary({
      mode: 'failure',
      checks: baseChecks(),
      errors: [],
      artifacts: {},
      records: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      tenantId: 't-1',
      entityId: 'e-1',
      failureInjection: { enabled: true, type: 'simulated', handled: true },
      autocorrection: { required: true, created: true, reason: 'created' },
    });

    expect(summary.status).toBe('passed');
    expect(summary.failureInjection).toEqual({
      enabled: true,
      type: 'simulated',
      handled: true,
    });
    expect(summary.governance?.decision).toBe('GO');
  });

  test('modo failure falha quando simulada não foi tratada', () => {
    const summary = generateSummary({
      mode: 'failure',
      checks: baseChecks(),
      errors: [],
      artifacts: {},
      records: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      tenantId: 't-1',
      entityId: 'e-1',
      failureInjection: { enabled: true, type: 'simulated', handled: false },
      autocorrection: { required: true, created: false, reason: 'missing' },
    });

    expect(summary.status).toBe('failed');
    expect(summary.failureInjection.handled).toBe(false);
    expect(summary.failureType).toBe('simulated_failure_unhandled');
    expect(summary.governance?.decision).toBe('NO_GO');
  });

  test('autocorrection só roda quando necessário', () => {
    expect(shouldRunAutoCorrection({ mode: 'real', criticalFailures: [] })).toBe(false);
    expect(shouldRunAutoCorrection({ mode: 'real', criticalFailures: ['entityCreated'] })).toBe(true);
    expect(shouldRunAutoCorrection({ mode: 'failure', criticalFailures: [] })).toBe(true);
  });

  test('replay registra step injected em falha simulada', () => {
    const recorder = new JourneyRecorder();
    recorder.injected('simulate_failure', { reason: 'test' }, { simulatedFailure: true });

    expect(recorder.steps).toHaveLength(1);
    expect(recorder.steps[0]).toEqual(expect.objectContaining({
      step: 'simulate_failure',
      status: 'injected',
    }));
  });
});

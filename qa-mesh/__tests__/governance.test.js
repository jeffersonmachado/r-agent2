'use strict';

const {
  MIN_EXECUTION_RATIO,
  evaluateGoNoGo,
  summarizeResults,
  evaluateWaveResult,
} = require('../governance');

describe('qa-mesh/governance', () => {
  test('marca NO_GO quando nenhum cenário é executado', () => {
    const result = evaluateGoNoGo([], { registryTotal: 0 });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.reasons).toContain('NO_SCENARIOS_EXECUTED');
    expect(result.reasons).toContain('INSUFFICIENT_COVERAGE');
    expect(result.executionQuality).toBe('invalid');
    expect(result.executionCoverage).toBe(0);
  });

  test('marca NO_GO quando cenário blocking falha', () => {
    const result = evaluateGoNoGo(
      [
        { id: 'critical-core', domain: 'core', criticality: 'blocking', status: 'failed' },
        { id: 'supporting-core', domain: 'core', criticality: 'medium', status: 'passed' },
      ],
      { registryTotal: 2 }
    );

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.reasons).toContain('BLOCKING_SCENARIO_FAILED');
    expect(result.reasons).toContain('CRITICAL_DOMAIN_FAILED:core');
  });

  test('marca NO_GO quando taxa de falha excede o limite', () => {
    const result = evaluateGoNoGo(
      [
        { id: 'ok-1', domain: 'beauty', criticality: 'medium', status: 'passed' },
        { id: 'fail-1', domain: 'beauty', criticality: 'medium', status: 'failed' },
        { id: 'fail-2', domain: 'fitness', criticality: 'medium', status: 'infra_error' },
      ],
      { registryTotal: 3, maxFailureRate: 0.2, criticalDomains: [] }
    );

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.reasons).toContain('FAILURE_RATE_ABOVE_THRESHOLD');
  });

  test('resume cobertura e qualidade corretamente', () => {
    const summary = summarizeResults(
      [
        { status: 'passed', domain: 'beauty' },
        { status: 'failed', domain: 'beauty' },
        { status: 'environment_missing', domain: 'core' },
        { status: 'infra_error', domain: 'pbx' },
        { status: 'flaky', domain: 'pbx' },
      ],
      5
    );

    expect(summary.registryTotal).toBe(5);
    expect(summary.attempted).toBe(5);
    expect(summary.executed).toBe(5);
    expect(summary.executionCoverage).toBeCloseTo(1);
    expect(summary.executionQuality).toBe('valid');
    expect(summary.domains.beauty.failed).toBe(1);
    expect(summary.domains.core.environment_missing).toBe(1);
    expect(summary.domains.pbx.infra_error).toBe(1);
    expect(summary.domains.pbx.flaky).toBe(1);
  });

  test('passed_via_fallback nao conta como passed e rastreia fallbackPassed', () => {
    const summary = summarizeResults(
      [
        { status: 'passed', domain: 'core' },
        { status: 'passed_via_fallback', domain: 'core' },
        { status: 'failed', domain: 'beauty' },
      ],
      3
    );

    expect(summary.passed).toBe(1);
    expect(summary.fallbackPassed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.executed).toBe(3);
    expect(summary.executionCoverage).toBeCloseTo(1);
    expect(summary.domains.core.passed).toBe(1);
    expect(summary.domains.core.fallbackPassed).toBe(1);
  });

  test('evaluateGoNoGo retorna NO_GO em strict mode quando existe fallback', () => {
    const result = evaluateGoNoGo(
      [
        { id: 'ok', domain: 'core', criticality: 'medium', status: 'passed' },
        { id: 'fall', domain: 'core', criticality: 'medium', status: 'passed_via_fallback' },
      ],
      { registryTotal: 2 }
    );

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.fallbackPassed).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.reasons).toContain('FALLBACK_USED_STRICT_MODE');
  });

  test('evaluateGoNoGo retorna NO_GO quando fallback ocorre em jornada blocking mesmo sem strict mode', () => {
    const result = evaluateGoNoGo(
      [
        {
          id: 'fall-support',
          domain: 'core',
          criticality: 'medium',
          status: 'passed_via_fallback',
          journeyId: 'support_ticket_flow',
        },
      ],
      { registryTotal: 1, strictMode: false }
    );

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.fallbackBlockingUsed).toBe(1);
    expect(result.reasons).toContain('FALLBACK_ON_BLOCKING_SCENARIO');
  });

  test('evaluateWaveResult retorna GO com todos checks verdadeiros', () => {
    const wave = evaluateWaveResult({
      status: 'passed',
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
        ticketLinked: true,
        taskLinked: true,
        insightCreated: true,
        actionCreated: true,
      },
    });

    expect(wave.decision).toBe('GO');
    expect(wave.severity).toBe('low');
  });

  test('evaluateWaveResult retorna NO_GO quando check crítico falha', () => {
    const wave = evaluateWaveResult({
      status: 'failed',
      checks: {
        entityCreated: false,
        linksCreated: true,
      },
    });

    expect(wave.decision).toBe('NO_GO');
    expect(wave.severity).toBe('critical');
    expect(wave.failedChecks).toContain('entityCreated');
  });

  test('evaluateWaveResult retorna REVIEW quando check high falha', () => {
    const wave = evaluateWaveResult({
      status: 'passed',
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
        ticketLinked: false,
      },
    });

    expect(wave.decision).toBe('REVIEW');
    expect(wave.severity).toBe('high');
  });

  test('evaluateWaveResult retorna GO_WITH_WARNINGS quando só medium/low falham', () => {
    const wave = evaluateWaveResult({
      status: 'passed',
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
        insightCreated: false,
      },
    });

    expect(wave.decision).toBe('GO_WITH_WARNINGS');
    expect(wave.failedChecks).toContain('insightCreated');
  });

  test('evaluateWaveResult respeita failureInjection handled', () => {
    const go = evaluateWaveResult({
      status: 'passed',
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
      },
      failureInjection: { enabled: true, type: 'simulated', handled: true },
    });
    expect(go.decision).toBe('GO');

    const noGo = evaluateWaveResult({
      status: 'passed',
      checks: {
        entityCreated: true,
        linksCreated: true,
        timelineConsistent: true,
        replayGenerated: true,
        evidenceGenerated: true,
      },
      failureInjection: { enabled: true, type: 'simulated', handled: false },
    });
    expect(noGo.decision).toBe('NO_GO');
  });
});

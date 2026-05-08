'use strict';

const { classifyScenarioResult, resolveBlockingPageNullDecision } = require('../meshRunner');

describe('qa-mesh/meshRunner strict mode classification', () => {
  test('blocking + page null em operational_go => NO_GO', () => {
    expect(resolveBlockingPageNullDecision('operational_go')).toBe('NO_GO');
  });

  test('diagnostic + page null => REVIEW', () => {
    expect(resolveBlockingPageNullDecision('diagnostic')).toBe('REVIEW');
  });

  test('nao lança ReferenceError ao classificar fallback com strictMode', () => {
    expect(() => classifyScenarioResult({
      id: 'support-flow',
      status: 'passed_via_fallback',
      journeyId: 'support_ticket_flow',
      startedAt: '2026-05-07T10:00:00.000Z',
      finishedAt: '2026-05-07T10:00:01.000Z',
    }, [], { strictMode: true })).not.toThrow();
  });

  test('fallback em strictMode vira fallback_degradation', () => {
    const result = classifyScenarioResult({
      id: 'support-flow',
      status: 'passed_via_fallback',
      journeyId: 'support_ticket_flow',
      startedAt: '2026-05-07T10:00:00.000Z',
      finishedAt: '2026-05-07T10:00:01.000Z',
    }, [], { strictMode: true });

    expect(result.status).toBe('failed');
    expect(result.failureType).toBe('fallback_degradation');
  });

  test('fallback fora de strict e fora de jornada blocking permanece degradado mas nao falha', () => {
    const result = classifyScenarioResult({
      id: 'generic-flow',
      status: 'passed_via_fallback',
      journeyId: 'generic_flow',
      startedAt: '2026-05-07T10:00:00.000Z',
      finishedAt: '2026-05-07T10:00:01.000Z',
    }, [], { strictMode: false });

    expect(result.status).toBe('passed_via_fallback');
    expect(result.failureType).toBeNull();
  });
});
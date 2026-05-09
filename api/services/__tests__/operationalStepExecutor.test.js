'use strict';

const {
  validateStepEvidence,
  validateReplayStepsEvidence,
} = require('../qa/operationalStepExecutor');

function buildStep(actionType, overrides = {}) {
  return {
    id: `step-${actionType}`,
    actionType,
    url: 'https://app.example.com/support',
    timestamp: '2024-01-01T00:00:00.000Z',
    screenshotBefore: 'data:image/png;base64,BEFORE',
    screenshotAfter: 'data:image/png;base64,AFTER',
    domAfter: '<html><body>ok</body></html>',
    networkEvents: [{ method: 'POST', url: '/api/tickets' }],
    selectorUsed: '[data-testid="ticket-send-button"]',
    snapshotDiff: { mutationCount: 1, valid: true },
    stepResult: { status: 'success' },
    evidenceId: `replay-1:execution-1:step-${actionType}`,
    mutationLinkage: { stepId: 'test-step-1', mutationCount: 1 },
    sideEffectLinkage: { expectedSideEffects: ['crm_updated'], observedSideEffects: ['crm_updated'] },
    ...overrides,
  };
}

describe('operationalStepExecutor evidence contracts by actionType', () => {
  test('navigate sem mutationLinkage => PASSA', () => {
    const step = buildStep('navigate', {
      mutationLinkage: null,
      sideEffectLinkage: null,
      selectorUsed: null,
      networkEvents: [],
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
  });

  test('navigate sem screenshotAfter => FALHA', () => {
    const step = buildStep('navigate', { screenshotAfter: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('screenshotAfter');
  });

  test('wait_for_list sem networkEvents => PASSA', () => {
    const step = buildStep('wait_for_list', { networkEvents: [] });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
  });

  test('type_and_send sem networkEvents => FALHA', () => {
    const step = buildStep('type_and_send', { networkEvents: [] });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('networkEvents');
  });

  test('type_and_send sem mutationLinkage => FALHA', () => {
    const step = buildStep('type_and_send', { mutationLinkage: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('mutationLinkage');
  });

  test('change_status sem sideEffectLinkage => FALHA', () => {
    const step = buildStep('change_status', { sideEffectLinkage: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('sideEffectLinkage');
  });

  test('assert_ui_state sem mutationLinkage => PASSA', () => {
    const step = buildStep('assert_ui_state', {
      mutationLinkage: null,
      sideEffectLinkage: null,
      networkEvents: [],
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
  });

  test('assert_backend_state sem selectorUsed => PASSA', () => {
    const step = buildStep('assert_backend_state', {
      selectorUsed: null,
      screenshotBefore: null,
      screenshotAfter: null,
      domAfter: null,
      networkEvents: [],
      mutationLinkage: null,
      sideEffectLinkage: null,
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
  });

  test('assert_backend_state sem snapshotDiff => PASSA', () => {
    const step = buildStep('assert_backend_state', { snapshotDiff: null, selectorUsed: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.missingEvidence).not.toContain('snapshotDiff');
  });

  test('assert_backend_state sem mutationLinkage => PASSA', () => {
    const step = buildStep('assert_backend_state', { mutationLinkage: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.missingEvidence).not.toContain('mutationLinkage');
  });

  test('assert_backend_state sem provenance => PASSA', () => {
    const step = buildStep('assert_backend_state', {
      mutationProvenance: null,
      postStateProof: null,
    });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.missingEvidence).not.toContain('mutationProvenance');
  });

  test('step_reply_ticket continua exigindo diff operacional via mutationLinkage => PASS', () => {
    const step = buildStep('type_and_send', { id: 'step_reply_ticket', mutationLinkage: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('mutationLinkage');
  });

  test('step_change_status continua exigindo provenance/linkage operacional => PASS', () => {
    const step = buildStep('change_status', { id: 'step_change_status', mutationLinkage: null });
    const result = validateStepEvidence(step, 'support_ticket_flow');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('mutationLinkage');
  });

  test('checkin_submit sem networkEvents => FALHA', () => {
    const step = buildStep('checkin_submit', { networkEvents: [] });
    const result = validateStepEvidence(step, 'fitness_customer_checkin');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingEvidence).toContain('networkEvents');
  });
});

describe('validateReplayStepsEvidence with executionMode', () => {
  test('replay vazio em blocking + operational_go => NO_GO', () => {
    const result = validateReplayStepsEvidence([], 'support_ticket_flow', { executionMode: 'operational_go' });
    expect(result.goNoGo).toBe('NO_GO');
  });

  test('replay vazio em blocking + diagnostic => REVIEW', () => {
    const result = validateReplayStepsEvidence([], 'support_ticket_flow', { executionMode: 'diagnostic' });
    expect(result.goNoGo).toBe('REVIEW');
  });
});

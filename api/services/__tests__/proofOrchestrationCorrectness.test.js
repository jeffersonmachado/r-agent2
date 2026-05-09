'use strict';

/**
 * proofOrchestrationCorrectness.test.js
 *
 * Testes obrigatórios para a orquestração correta do pipeline de prova:
 *
 *  1. validateOperationalReplay sem afterSnapshot => NÃO EXECUTA (preconditionFailed)
 *  2. governance rebuild limpa blockers temporários
 *  3. normalizeReplayOperationalStep preserva proofChain completa
 *  4. executeScenario não remove mutation proof (mutationLinkage, stepExecutionProof, etc.)
 *  5. diff global sem step correlation => NO_GO (deriveStepScopedMutations)
 *  6. reply_ticket sem message_created => NO_GO
 *  7. change_status sem status_changed => NO_GO
 *  8. checkin_submit sem attendance_created => NO_GO
 */

const operationalReplayValidator = require('../qa/operationalReplayValidator');
const { rebuildGovernanceState } = require('../qaWavesExecutionService');
const { normalizeReplayOperationalStep, executeScenario } = require('../qaWavesExecutionEngine');
const {
  deriveStepScopedMutations,
} = require('../../../qa/evidence/postStateProofValidator');
const {
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
} = require('../../../qa/contracts/operationalStepRegistry');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSupportSnapshot(overrides = {}) {
  return {
    state: 'ticket_open',
    db: {
      ticket: { exists: true, status: 'open', messages: { count: 1 } },
      ticketStatus: 'open',
    },
    api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
    crm: { activities: { count: 0 } },
    events: { audit: { count: 0 } },
    metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
    ...overrides,
  };
}

function makeReplyStep(overrides = {}) {
  return {
    id: 'step_reply_ticket',
    actionType: 'type_and_send',
    selectorUsed: '[data-testid="ticket-send-button"]',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/support/ticket/1',
    domSnapshot: '<html></html>',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/tickets/1/reply',
        status: 201,
      },
    ],
    ...overrides,
  };
}

function makeChangeStatusStep(overrides = {}) {
  return {
    id: 'step_change_status',
    actionType: 'change_status',
    selectorUsed: '[data-testid="status-select"]',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/support/ticket/1',
    domSnapshot: '<html></html>',
    networkEvents: [
      {
        type: 'response',
        method: 'PATCH',
        url: 'http://localhost/api/tickets/1/status',
        status: 200,
      },
    ],
    ...overrides,
  };
}

function makeCheckinStep(overrides = {}) {
  return {
    id: 'step_submit_checkin',
    actionType: 'checkin_submit',
    selectorUsed: '[data-testid="checkin-submit"]',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/access/checkin',
    domSnapshot: '<html></html>',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/fitness/checkin',
        status: 200,
      },
    ],
    ...overrides,
  };
}

function withStepSnapshots(step, beforeStepSnapshot, afterStepSnapshot) {
  return {
    ...step,
    beforeStepSnapshot,
    afterStepSnapshot,
    mutationExpected: true,
  };
}

// ---------------------------------------------------------------------------
// TESTE 1: validateOperationalReplay sem afterSnapshot => NÃO EXECUTA
// ---------------------------------------------------------------------------

describe('1. validateOperationalReplay sem afterSnapshot — NÃO EXECUTA para blocking journey', () => {
  test('retorna preconditionFailed=true e blockers vazios quando afterSnapshot é null', () => {
    const result = operationalReplayValidator.validateOperationalReplay({
      journeyId: 'support_ticket_flow',
      replayId: 'replay-1',
      beforeSnapshot: makeSupportSnapshot(),
      afterSnapshot: null,   // ← não coletado ainda
      steps: [makeReplyStep()],
      events: [],
      screenshots: [],
    });

    expect(result.preconditionFailed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.isOperational).toBe(false);
    expect(result.preconditionReason).toBe('after_snapshot_not_yet_collected');
  });

  test('retorna preconditionFailed=true para fitness_customer_checkin sem afterSnapshot', () => {
    const result = operationalReplayValidator.validateOperationalReplay({
      journeyId: 'fitness_customer_checkin',
      replayId: 'replay-2',
      beforeSnapshot: { state: 'checkin_pending' },
      afterSnapshot: null,
    });

    expect(result.preconditionFailed).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  test('NÃO retorna preconditionFailed para jornadas não-blocking sem afterSnapshot', () => {
    const result = operationalReplayValidator.validateOperationalReplay({
      journeyId: 'generic_journey',
      replayId: 'replay-3',
      afterSnapshot: null,
    });

    expect(result.preconditionFailed).toBeFalsy();
    // Pode retornar blockers por outros motivos, mas não por precondição
  });

  test('executa normalmente quando afterSnapshot existe', () => {
    const result = operationalReplayValidator.validateOperationalReplay({
      journeyId: 'support_ticket_flow',
      replayId: 'replay-4',
      beforeSnapshot: makeSupportSnapshot(),
      afterSnapshot: makeSupportSnapshot({ db: { ticket: { exists: true, status: 'replied', messages: { count: 2 } } } }),
      steps: [makeReplyStep()],
      screenshots: [],
      events: [],
    });

    // Com afterSnapshot: função executa normalmente (pode ter blockers por outros motivos,
    // mas NÃO retorna preconditionFailed)
    expect(result.preconditionFailed).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// TESTE 2: governance rebuild limpa blockers temporários
// ---------------------------------------------------------------------------

describe('2. rebuildGovernanceState — limpa blockers temporários', () => {
  test('retorna GO com governanceBlockers vazio quando sem blockers', () => {
    const result = rebuildGovernanceState({ blockers: [] });

    expect(result.governanceStatus).toBe('GO');
    expect(result.governanceBlockers).toHaveLength(0);
    expect(result.result).toBe('success');
  });

  test('retorna NO_GO com blockers reais', () => {
    const result = rebuildGovernanceState({
      blockers: [{ reason: 'missing_real_state_mutation' }],
    });

    expect(result.governanceStatus).toBe('NO_GO');
    expect(result.governanceBlockers).toHaveLength(1);
    expect(result.result).toBe('failed');
  });

  test('NÃO propaga blockers antigos do replay anterior', () => {
    // Simula um replay que tinha blockers do before snapshot (temporários)
    const staleBlockers = [
      { reason: 'snapshot_before_collection_failed' },
      { reason: 'support_flow_missing_crm_validation' },
    ];

    // rebuildGovernanceState ignora blockers anteriores — só usa o que é passado
    const freshResult = rebuildGovernanceState({ blockers: [] });

    // Blockers antigos NÃO aparecem no resultado
    expect(freshResult.governanceBlockers).toHaveLength(0);
    expect(freshResult.governanceStatus).toBe('GO');
    // O staleBlockers é irrelevante — não foi passado, não aparece
    expect(freshResult.governanceBlockers).not.toEqual(expect.arrayContaining(staleBlockers));
  });

  test('filtra blockers nulos/undefined', () => {
    const result = rebuildGovernanceState({
      blockers: [null, undefined, { reason: 'real_blocker' }, null],
    });

    expect(result.governanceBlockers).toHaveLength(1);
    expect(result.governanceBlockers[0].reason).toBe('real_blocker');
    expect(result.governanceStatus).toBe('NO_GO');
  });

  test('rebuild com múltiplos blockers de fontes diferentes', () => {
    const result = rebuildGovernanceState({
      blockers: [
        { reason: 'runtime_step_failed', source: 'browser' },
        { reason: 'post_state_proof_snapshot_unchanged', source: 'post_state' },
        { reason: 'step_mutation_correlation_failed', stepId: 'step_reply_ticket' },
      ],
    });

    expect(result.governanceStatus).toBe('NO_GO');
    expect(result.governanceBlockers).toHaveLength(3);
    expect(result.result).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// TESTE 3: normalizeReplayOperationalStep preserva proofChain
// ---------------------------------------------------------------------------

describe('3. normalizeReplayOperationalStep — preserva proofChain completa', () => {
  const proofChainFixture = {
    browserAction: true,
    networkProof: true,
    screenshotBefore: true,
    screenshotAfter: true,
    domCaptured: true,
    urlCaptured: true,
    snapshotDiff: true,
    observedMutations: ['message_created'],
    observedSideEffects: ['audit_log_created'],
    mutationCount: 1,
    finalStateProof: true,
    stepExecutionValid: true,
    postStateValid: true,
    complete: true,
  };

  const stepExecutionProofFixture = {
    phase: 'step_execution',
    valid: true,
    blockers: [],
    networkProof: { valid: true },
    hasUrl: true,
    hasSelector: true,
  };

  const postStateProofFixture = {
    phase: 'post_state',
    valid: true,
    blockers: [],
    observedMutations: ['message_created'],
    observedSideEffects: ['audit_log_created', 'crm_updated'],
    mutationCount: 1,
    diff: { changed: true, details: [] },
  };

  const runtimeStepWithProofChain = {
    id: 'step_reply_ticket',
    actionType: 'type_and_send',
    success: true,
    selectorUsed: '#reply',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/support/ticket/1',
    domSnapshot: '<html></html>',
    networkEvents: [{ type: 'response', url: '/api/tickets/1/reply', method: 'POST', status: 201 }],
    evidenceId: 'evidence-1',
    stepResult: { status: 'success' },
    mutationLinkage: { stepId: 'step_reply_ticket', mutationCount: 1 },
    snapshotDiff: { changed: true, details: [{ field: 'messages_count', before: 1, after: 2 }] },
    sideEffectLinkage: { expectedSideEffects: ['audit_log_created'], observedSideEffects: ['audit_log_created'] },
    observedMutations: ['message_created'],
    observedSideEffects: ['audit_log_created', 'crm_updated'],
    proofBlockers: [],
    proofGoNoGo: null,
    scopedMutations: { stepId: 'step_reply_ticket', scopedMutations: ['message_created'] },
    stepExecutionProof: stepExecutionProofFixture,
    postStateProof: postStateProofFixture,
    proofChain: proofChainFixture,
    networkProof: { valid: true },
  };

  const scenarioStep = {
    id: 'step_reply_ticket',
    type: 'fill',
    category: 'RPA_ACTION',
    name: 'Responder ticket',
  };

  test('preserva stepExecutionProof', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.stepExecutionProof).toEqual(stepExecutionProofFixture);
  });

  test('preserva postStateProof', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.postStateProof).toEqual(postStateProofFixture);
  });

  test('preserva proofChain completa', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.proofChain).toEqual(proofChainFixture);
  });

  test('preserva snapshotDiff', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.snapshotDiff).toEqual(runtimeStepWithProofChain.snapshotDiff);
  });

  test('preserva mutationLinkage', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.mutationLinkage).toEqual(runtimeStepWithProofChain.mutationLinkage);
  });

  test('preserva sideEffectLinkage', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.sideEffectLinkage).toEqual(runtimeStepWithProofChain.sideEffectLinkage);
  });

  test('preserva observedMutations', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.observedMutations).toEqual(['message_created']);
  });

  test('preserva observedSideEffects', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.observedSideEffects).toEqual(['audit_log_created', 'crm_updated']);
  });

  test('preserva scopedMutations', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.scopedMutations).toEqual(runtimeStepWithProofChain.scopedMutations);
  });

  test('preserva networkProof', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.networkProof).toEqual({ valid: true });
  });

  test('preserva proofBlockers', () => {
    const result = normalizeReplayOperationalStep(scenarioStep, runtimeStepWithProofChain, 0, [runtimeStepWithProofChain]);
    expect(result.proofBlockers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TESTE 4: executeScenario não remove mutation proof
// ---------------------------------------------------------------------------

describe('4. executeScenario — não remove mutation proof dos steps', () => {
  test('preserva mutationLinkage do runtimeStep', () => {
    const semanticSteps = [
      {
        id: 'step_reply_ticket',
        type: 'fill',
        category: 'RPA_ACTION',
        name: 'Responder ticket',
      },
    ];

    const runtimeSteps = [
      {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        success: true,
        selectorUsed: '#reply',
        screenshotBefore: 'data:image/png;base64,before',
        screenshotAfter: 'data:image/png;base64,after',
        url: 'http://localhost/support',
        domSnapshot: '<html></html>',
        networkEvents: [],
        mutationLinkage: {
          stepId: 'step_reply_ticket',
          mutationCount: 2,
          observedSideEffects: ['audit_log_created'],
        },
        stepExecutionProof: { phase: 'step_execution', valid: true, blockers: [] },
        postStateProof: { phase: 'post_state', valid: true, observedMutations: ['message_created'] },
        proofChain: { complete: true, observedMutations: ['message_created'] },
        snapshotDiff: { changed: true },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
      },
    ];

    const result = executeScenario({ semanticSteps, runtimeSteps });

    expect(result.steps[0].mutationLinkage).toEqual(runtimeSteps[0].mutationLinkage);
    expect(result.steps[0].stepExecutionProof).toEqual(runtimeSteps[0].stepExecutionProof);
    expect(result.steps[0].postStateProof).toEqual(runtimeSteps[0].postStateProof);
    expect(result.steps[0].proofChain).toEqual(runtimeSteps[0].proofChain);
    expect(result.steps[0].snapshotDiff).toEqual(runtimeSteps[0].snapshotDiff);
    expect(result.steps[0].observedMutations).toEqual(['message_created']);
    expect(result.steps[0].observedSideEffects).toEqual(['audit_log_created']);
  });

  test('preserva todos os campos de prova mesmo em step com status failed', () => {
    const semanticSteps = [
      { id: 'step_change_status', type: 'click', category: 'RPA_ACTION', name: 'Mudar status' },
    ];

    const runtimeSteps = [
      {
        id: 'step_change_status',
        actionType: 'change_status',
        success: false,
        selectorUsed: '#status',
        screenshotBefore: 'before.png',
        screenshotAfter: 'after.png',
        url: 'http://localhost/support',
        domSnapshot: '<html></html>',
        networkEvents: [],
        stepExecutionProof: { phase: 'step_execution', valid: false, blockers: [{ reason: 'network_missing' }] },
        proofChain: { complete: false, stepExecutionValid: false },
        proofBlockers: [{ reason: 'network_missing' }],
        proofGoNoGo: 'NO_GO',
      },
    ];

    const result = executeScenario({ semanticSteps, runtimeSteps });

    expect(result.steps[0].stepExecutionProof).toEqual(runtimeSteps[0].stepExecutionProof);
    expect(result.steps[0].proofChain).toEqual(runtimeSteps[0].proofChain);
    expect(result.steps[0].proofBlockers).toEqual([{ reason: 'network_missing' }]);
    expect(result.steps[0].proofGoNoGo).toBe('NO_GO');
  });
});

// ---------------------------------------------------------------------------
// TESTE 5: diff global sem step correlation => NO_GO
// ---------------------------------------------------------------------------

describe('5. deriveStepScopedMutations — diff global sem step responsável => NO_GO', () => {
  const beforeSnapshot = { db: { messages: { count: 1 }, ticket: { status: 'open' } } };
  const afterSnapshot = { db: { messages: { count: 2 }, ticket: { status: 'open' } } };

  test('step_reply_ticket com message_created no diff => GO', () => {
    const result = deriveStepScopedMutations(
      [withStepSnapshots(makeReplyStep(), beforeSnapshot, afterSnapshot)],
      beforeSnapshot,
      afterSnapshot,
    );

    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('step_reply_ticket');
    expect(result[0].scopedMutations).toContain('message_created');
    expect(result[0].goNoGo).toBeNull();
    expect(result[0].mutationMissing).toBe(false);
  });

  test('step_reply_ticket SEM message_created no diff => NO_GO', () => {
    const sameMessages = { db: { messages: { count: 1 }, ticket: { status: 'replied' } } };
    const result = deriveStepScopedMutations(
      [withStepSnapshots(makeReplyStep(), beforeSnapshot, sameMessages)],
      beforeSnapshot,
      sameMessages,
    );

    expect(result[0].stepId).toBe('step_reply_ticket');
    expect(result[0].scopedMutations).not.toContain('message_created');
    expect(result[0].goNoGo).toBe('NO_GO');
    expect(result[0].mutationMissing).toBe(true);
  });

  test('correlationBasis é "step_incremental" em correlação causal por step', () => {
    const result = deriveStepScopedMutations(
      [withStepSnapshots(makeReplyStep(), beforeSnapshot, afterSnapshot)],
      beforeSnapshot,
      afterSnapshot,
    );

    expect(result[0].correlationBasis).toBe('step_incremental');
  });

  test('networkCorrelation captura network events do step', () => {
    const result = deriveStepScopedMutations(
      [withStepSnapshots(makeReplyStep(), beforeSnapshot, afterSnapshot)],
      beforeSnapshot,
      afterSnapshot,
    );

    expect(result[0].networkCorrelation).toHaveLength(1);
    expect(result[0].networkCorrelation[0].method).toBe('POST');
    expect(result[0].networkCorrelation[0].url).toContain('/reply');
  });

  test('array vazio de steps retorna array vazio', () => {
    const result = deriveStepScopedMutations([], beforeSnapshot, afterSnapshot);
    expect(result).toHaveLength(0);
  });

  test('diff null retorna mutations vazias para step com contrato', () => {
    const result = deriveStepScopedMutations([withStepSnapshots(makeReplyStep(), null, null)], null, null, null);

    expect(result[0].scopedMutations).toHaveLength(0);
    expect(result[0].goNoGo).toBe('NO_GO');
    expect(result[0].mutationMissing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TESTE 6: reply_ticket sem message_created => NO_GO
// ---------------------------------------------------------------------------

describe('6. reply_ticket sem message_created => NO_GO', () => {
  test('step_reply_ticket: contrato exige message_created', () => {
    const mutations = getExpectedMutationsForStep('step_reply_ticket');
    expect(mutations).toContain('message_created');
  });

  test('diff sem db.messages.count aumentado => goNoGo=NO_GO para step_reply_ticket', () => {
    const before = { db: { messages: { count: 5 }, ticket: { status: 'open' } } };
    const after = { db: { messages: { count: 5 }, ticket: { status: 'open' } } };

    const step = withStepSnapshots(makeReplyStep(), before, after);
    const result = deriveStepScopedMutations([step], before, after);

    expect(result[0].goNoGo).toBe('NO_GO');
    expect(result[0].scopedMutations).not.toContain('message_created');
    expect(result[0].mutationMissing).toBe(true);
  });

  test('diff com db.messages.count aumentado => goNoGo=null para step_reply_ticket', () => {
    const before = { db: { messages: { count: 5 } } };
    const after = { db: { messages: { count: 6 } } };

    const result = deriveStepScopedMutations([withStepSnapshots(makeReplyStep(), before, after)], before, after);

    expect(result[0].goNoGo).toBeNull();
    expect(result[0].scopedMutations).toContain('message_created');
    expect(result[0].mutationMissing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TESTE 7: change_status sem status_changed => NO_GO
// ---------------------------------------------------------------------------

describe('7. change_status sem status_changed => NO_GO', () => {
  test('step_change_status: contrato exige ticket_status_changed', () => {
    const mutations = getExpectedMutationsForStep('step_change_status');
    expect(mutations).toContain('ticket_status_changed');
  });

  test('diff sem mudança de status => goNoGo=NO_GO para step_change_status', () => {
    const before = { db: { ticket: { status: 'open' } } };
    const after = { db: { ticket: { status: 'open' } } };

    const result = deriveStepScopedMutations([withStepSnapshots(makeChangeStatusStep(), before, after)], before, after);

    expect(result[0].goNoGo).toBe('NO_GO');
    expect(result[0].mutationMissing).toBe(true);
  });

  test('diff com status mudado => goNoGo=null para step_change_status', () => {
    const before = { db: { ticket: { status: 'open' } } };
    const after = { db: { ticket: { status: 'resolved' } } };

    const result = deriveStepScopedMutations([withStepSnapshots(makeChangeStatusStep(), before, after)], before, after);

    expect(result[0].goNoGo).toBeNull();
    expect(result[0].scopedMutations).toContain('ticket_status_changed');
  });
});

// ---------------------------------------------------------------------------
// TESTE 8: checkin_submit sem attendance_created => NO_GO
// ---------------------------------------------------------------------------

describe('8. checkin_submit sem attendance_created => NO_GO', () => {
  test('step_submit_checkin: contrato exige attendance_created', () => {
    const mutations = getExpectedMutationsForStep('step_submit_checkin');
    expect(mutations).toContain('attendance_created');
  });

  test('diff sem db.attendance.count aumentado => goNoGo=NO_GO para checkin_submit', () => {
    const before = { db: { attendance: { count: 0 } }, api: { access: { decision: { count: 0 } } } };
    const after = { db: { attendance: { count: 0 } }, api: { access: { decision: { count: 0 } } } };

    const result = deriveStepScopedMutations([withStepSnapshots(makeCheckinStep(), before, after)], before, after);

    expect(result[0].goNoGo).toBe('NO_GO');
    expect(result[0].mutationMissing).toBe(true);
  });

  test('diff com db.attendance.count aumentado => goNoGo=null para checkin_submit', () => {
    const before = { db: { attendance: { count: 0 } }, api: { access: { decision: { count: 0 } } } };
    const after = { db: { attendance: { count: 1 } }, api: { access: { decision: { count: 1 } } } };

    const result = deriveStepScopedMutations([withStepSnapshots(makeCheckinStep(), before, after)], before, after);

    expect(result[0].goNoGo).toBeNull();
    expect(result[0].scopedMutations).toContain('attendance_created');
  });
});

// ---------------------------------------------------------------------------
// TESTE BÔNUS: correlação de múltiplos steps numa jornada completa
// ---------------------------------------------------------------------------

describe('9. Correlação múltiplos steps — jornada completa support_ticket_flow', () => {
  test('jornada completa: cada step tem suas mutações correlacionadas', () => {
    const before = { db: { messages: { count: 1 }, ticket: { status: 'open' } } };
    const after = { db: { messages: { count: 2 }, ticket: { status: 'replied' } } };

    const steps = [
      withStepSnapshots(makeReplyStep(), { db: { messages: { count: 1 }, ticket: { status: 'open' } } }, { db: { messages: { count: 2 }, ticket: { status: 'open' } } }),
      withStepSnapshots(makeChangeStatusStep(), { db: { ticket: { status: 'open' } } }, { db: { ticket: { status: 'replied' } } }),
    ];

    const result = deriveStepScopedMutations(steps, before, after);

    expect(result).toHaveLength(2);

    // step_reply_ticket → message_created
    const replyResult = result.find((r) => r.stepId === 'step_reply_ticket');
    expect(replyResult).toBeDefined();
    expect(replyResult.scopedMutations).toContain('message_created');
    expect(replyResult.goNoGo).toBeNull();

    // step_change_status → ticket_status_changed
    const statusResult = result.find((r) => r.stepId === 'step_change_status');
    expect(statusResult).toBeDefined();
    expect(statusResult.scopedMutations).toContain('ticket_status_changed');
    expect(statusResult.goNoGo).toBeNull();
  });
});

'use strict';

/**
 * proofPipelinePhases.test.js
 *
 * Testes obrigatórios para as duas fases do pipeline de prova:
 *   - Fase 1: STEP EXECUTION (stepExecutionProofValidator)
 *   - Fase 2: POST STATE    (postStateProofValidator)
 *
 * Verifica explicitamente que:
 *   1. validateStepExecutionProof SEM afterSnapshot → PASSA (afterSnapshot não é requerido)
 *   2. validatePostStateProof SEM afterSnapshot → FALHA (blocker: post_state_proof_missing_after_snapshot)
 *   3. validatePostStateProof com diff SEM mudança → FALHA (step_reply_ticket)
 *   4. validatePostStateProof com diff com mudança mas SEM mutações esperadas → FALHA
 *   5. validatePostStateProof com before == after → FALHA
 *   6. network proof correto mas sem mutation → FALHA no post_state (não no step_execution)
 *   7. mutation correta mas sem side effect esperado → FALHA no post_state
 *   8. pipeline completo: step_execution PASS + post_state PASS
 *   9. deriveObservedMutations: messages_count++ → ['message_created']
 *  10. deriveObservedMutations: attendance_count++ → inclui attendance_created
 *  11. deriveObservedSideEffects: campo messages_count → inclui audit_log_created, crm_updated
 *  12. appendProofChainToReplay retorna proofChain consolidado
 */

const {
  validateStepExecutionProof,
} = require('../../../qa/evidence/stepExecutionProofValidator');

const {
  validatePostStateProof,
  deriveObservedMutations,
  deriveObservedSideEffects,
  appendProofChainToReplay,
} = require('../../../qa/evidence/postStateProofValidator');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BLOCKING_CONTEXT = { isBlockingJourney: true, executionMode: 'operational_go', journeyId: 'support_ticket_flow' };
const NONBLOCKING_CONTEXT = { isBlockingJourney: false, executionMode: 'operational_go', journeyId: 'test_journey' };
const DIAGNOSTIC_CONTEXT = { isBlockingJourney: true, executionMode: 'diagnostic', journeyId: 'support_ticket_flow' };

function makeStep(overrides = {}) {
  return {
    id: 'step_reply_ticket',
    actionType: 'type_and_send',
    selectorUsed: '#reply-box',
    screenshotBefore: 'data:image/png;base64,abc',
    screenshotAfter: 'data:image/png;base64,def',
    url: 'http://localhost/ticket/123',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/tickets/123/reply',
        status: 201,
        path: '/api/tickets/123/reply',
      },
    ],
    ...overrides,
  };
}

function makeSnapshotBefore() {
  return { messages_count: 3, status: 'open', attendance_count: 0 };
}

function makeSnapshotAfter(overrides = {}) {
  return { messages_count: 4, status: 'open', attendance_count: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// FASE 1: STEP EXECUTION PROOF
// ---------------------------------------------------------------------------

describe('Fase 1 — validateStepExecutionProof (step-time)', () => {
  test('1. DEVE passar sem afterSnapshot (afterSnapshot não é requerido no step-time)', () => {
    // afterSnapshot nunca é passado para validateStepExecutionProof
    const step = makeStep();
    const result = validateStepExecutionProof(step, BLOCKING_CONTEXT);

    expect(result.phase).toBe('step_execution');
    // Não deve falhar por ausência de afterSnapshot
    // (pode falhar por outras razões, mas não por afterSnapshot)
    const hasAfterSnapshotBlocker = (result.blockers || []).some(
      (b) => b.reason && b.reason.includes('after_snapshot'),
    );
    expect(hasAfterSnapshotBlocker).toBe(false);
  });

  test('2. DEVE passar com todos os campos presentes', () => {
    const step = makeStep();
    const result = validateStepExecutionProof(step, NONBLOCKING_CONTEXT);

    expect(result.phase).toBe('step_execution');
    expect(result.valid).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  test('3. DEVE falhar com selectorUsed faltando para type_and_send', () => {
    const step = makeStep({ selectorUsed: undefined });
    const result = validateStepExecutionProof(step, NONBLOCKING_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.missingBrowserFields).toContain('selectorUsed');
  });

  test('4. DEVE falhar com screenshotAfter faltando para type_and_send', () => {
    const step = makeStep({ screenshotAfter: undefined });
    const result = validateStepExecutionProof(step, NONBLOCKING_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.missingBrowserFields).toContain('screenshotAfter');
  });

  test('5. goNoGo deve ser NO_GO quando blocking e evidência faltando', () => {
    const step = makeStep({ selectorUsed: undefined });
    const result = validateStepExecutionProof(step, BLOCKING_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
  });

  test('6. goNoGo deve ser REVIEW quando diagnostic e evidência faltando', () => {
    const step = makeStep({ selectorUsed: undefined });
    const result = validateStepExecutionProof(step, DIAGNOSTIC_CONTEXT);

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('REVIEW');
  });

  test('7. Retorna hasUrl e hasSelector corretos', () => {
    const step = makeStep();
    const result = validateStepExecutionProof(step, NONBLOCKING_CONTEXT);

    expect(result.hasUrl).toBe(true);
    expect(result.hasSelector).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FASE 2: POST STATE PROOF — guards
// ---------------------------------------------------------------------------

describe('Fase 2 — validatePostStateProof (post-state)', () => {
  test('8. DEVE FALHAR sem afterSnapshot (blocker: post_state_proof_missing_after_snapshot)', () => {
    const step = makeStep();
    const result = validatePostStateProof({
      beforeSnapshot: makeSnapshotBefore(),
      afterSnapshot: null,
      step,
      journeyContext: BLOCKING_CONTEXT,
    });

    expect(result.phase).toBe('post_state');
    expect(result.valid).toBe(false);
    expect(result.afterSnapshotPresent).toBe(false);
    const blocker = (result.blockers || []).find(
      (b) => b.reason === 'post_state_proof_missing_after_snapshot',
    );
    expect(blocker).toBeDefined();
  });

  test('9. DEVE FALHAR quando before === after (step_reply_ticket)', () => {
    const before = makeSnapshotBefore();
    const after = makeSnapshotBefore(); // idêntico
    const step = makeStep();

    const result = validatePostStateProof({
      beforeSnapshot: before,
      afterSnapshot: after,
      step,
      journeyContext: BLOCKING_CONTEXT,
    });

    expect(result.valid).toBe(false);
    const blockerReasons = (result.blockers || []).map((b) => b.reason);
    expect(blockerReasons).toContain('post_state_proof_snapshot_unchanged');
  });

  test('10. DEVE FALHAR quando mutação esperada não foi observada', () => {
    const before = makeSnapshotBefore();
    // after tem só status changed, mas esperado é message_created
    const after = { ...makeSnapshotBefore(), status: 'resolved' };
    const step = makeStep({ actionType: 'type_and_send' });

    const result = validatePostStateProof({
      beforeSnapshot: before,
      afterSnapshot: after,
      step,
      journeyContext: BLOCKING_CONTEXT,
    });

    expect(result.valid).toBe(false);
    const blockerReasons = (result.blockers || []).map((b) => b.reason);
    expect(blockerReasons).toContain('post_state_proof_expected_mutations_not_observed');
  });

  test('11. DEVE PASSAR quando todas as mutações e side effects são observados', () => {
    const before = makeSnapshotBefore();
    const after = makeSnapshotAfter(); // messages_count: 3 → 4

    // Para step type_and_send / step_reply_ticket com messages_count++:
    // expected mutations: ['message_created']
    // observedMutations derivadas: ['message_created'] (via deriveObservedMutations)
    // expected side effects: ['audit_log_created', 'crm_updated']
    // observedSideEffects: audit_log_created, crm_updated via SIDE_EFFECT_DERIVATION_RULES

    // Nota: o contrato para type_and_send espera ['message_created']
    // O diff vai ter messages_count: 3→4 → deriveObservedMutations → ['message_created'] ✓
    // Side effects esperados para type_and_send: ['audit_log_created']
    // Side effects derivados do campo messages_count: audit_log_created, crm_updated ✓

    const result = validatePostStateProof({
      beforeSnapshot: before,
      afterSnapshot: after,
      step: makeStep(),
      journeyContext: BLOCKING_CONTEXT,
    });

    // Se valid=false, mostramos os blockers para diagnóstico
    if (!result.valid) {
      console.error('Blockers inesperados:', JSON.stringify(result.blockers, null, 2));
    }

    expect(result.phase).toBe('post_state');
    expect(result.afterSnapshotPresent).toBe(true);
    expect(result.diff).toBeDefined();
    expect(result.observedMutations).toContain('message_created');
    expect(result.mutationCount).toBeGreaterThan(0);
    expect(result.valid).toBe(true);
  });

  test('12. Passos não-mutacionais (navigate) devem passar sem diff obrigatório', () => {
    const before = makeSnapshotBefore();
    const after = makeSnapshotBefore(); // nenhuma mudança

    const step = {
      id: 'step_navigate',
      actionType: 'navigate',
      url: 'http://localhost/dashboard',
      screenshotAfter: 'data:image/png;base64,xxx',
    };

    const result = validatePostStateProof({
      beforeSnapshot: before,
      afterSnapshot: after,
      step,
      journeyContext: BLOCKING_CONTEXT,
    });

    // navigate não está em POST_STATE_REQUIRED_TYPES
    expect(result.requiresPostState).toBe(false);
    expect(result.valid).toBe(true);
  });

  test('13. Sem beforeSnapshot: diff ainda funciona (before=null)', () => {
    const step = makeStep();
    const after = makeSnapshotAfter();

    const result = validatePostStateProof({
      beforeSnapshot: null,
      afterSnapshot: after,
      step,
      journeyContext: NONBLOCKING_CONTEXT,
    });

    // Com before=null, computeRealSnapshotDiff deve tratar graciosamente
    expect(result.afterSnapshotPresent).toBe(true);
    expect(result).toHaveProperty('diff');
  });
});

// ---------------------------------------------------------------------------
// Derivation engine
// ---------------------------------------------------------------------------

describe('Derivation engine', () => {
  test('14. messages_count++ → deriveObservedMutations inclui message_created', () => {
    const diff = {
      changed: true,
      details: [{ field: 'messages_count', before: 3, after: 4 }],
    };

    const result = deriveObservedMutations(diff);
    expect(result).toContain('message_created');
  });

  test('15. attendance_count++ → inclui attendance_created', () => {
    const diff = {
      changed: true,
      details: [{ field: 'attendance_count', before: 0, after: 1 }],
    };

    const result = deriveObservedMutations(diff);
    expect(result).toContain('attendance_created');
  });

  test('16. status changed → inclui ticket_status_changed', () => {
    const diff = {
      changed: true,
      details: [{ field: 'status', before: 'open', after: 'resolved' }],
    };

    const result = deriveObservedMutations(diff);
    expect(result).toContain('ticket_status_changed');
  });

  test('17. diff sem mudança → retorna []', () => {
    const diff = { changed: false, details: [] };
    const result = deriveObservedMutations(diff);
    expect(result).toHaveLength(0);
  });

  test('18. campo messages_count → deriveObservedSideEffects inclui audit_log_created e crm_updated', () => {
    const diff = {
      changed: true,
      details: [{ field: 'messages_count', before: 3, after: 4 }],
    };

    const result = deriveObservedSideEffects(diff);
    expect(result).toContain('audit_log_created');
    expect(result).toContain('crm_updated');
  });

  test('19. campo attendance_count → inclui crm_journey_updated', () => {
    const diff = {
      changed: true,
      details: [{ field: 'attendance_count', before: 0, after: 1 }],
    };

    const result = deriveObservedSideEffects(diff);
    expect(result).toContain('crm_journey_updated');
  });

  test('20. diff sem mudança → side effects []', () => {
    const diff = { changed: false, details: [] };
    const result = deriveObservedSideEffects(diff);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// appendProofChainToReplay
// ---------------------------------------------------------------------------

describe('appendProofChainToReplay', () => {
  test('21. Retorna proofChain consolidado com campos de ambas as fases', () => {
    const enrichedStep = makeStep();
    const stepExecProof = {
      phase: 'step_execution',
      valid: true,
      hasUrl: true,
      hasSelector: true,
      missingBrowserFields: [],
      networkProof: { valid: true, noContract: false },
      blockers: [],
      goNoGo: null,
    };
    const postStateProof = {
      phase: 'post_state',
      valid: true,
      requiresPostState: true,
      afterSnapshotPresent: true,
      diff: { changed: true, details: [] },
      observedMutations: ['message_created'],
      observedSideEffects: ['audit_log_created'],
      mutationCount: 1,
      blockers: [],
      goNoGo: null,
    };

    const result = appendProofChainToReplay(enrichedStep, stepExecProof, postStateProof);

    expect(result.proofChain).toBeDefined();
    expect(result.proofChain.stepExecutionValid).toBe(true);
    expect(result.proofChain.postStateValid).toBe(true);
    expect(result.proofChain.complete).toBe(true);
    expect(result.proofChain.observedMutations).toContain('message_created');
    expect(result.proofChain.observedSideEffects).toContain('audit_log_created');
    expect(result.proofChain.mutationCount).toBe(1);
    expect(result.stepExecutionProof).toBe(stepExecProof);
    expect(result.postStateProof).toBe(postStateProof);
    expect(result.proofBlockers).toHaveLength(0);
    expect(result.proofGoNoGo).toBeNull();
  });

  test('22. proofChain.complete false quando step_execution falha', () => {
    const enrichedStep = makeStep();
    const stepExecProof = {
      phase: 'step_execution',
      valid: false,
      blockers: [{ reason: 'step_execution_missing_browser_evidence' }],
      goNoGo: 'NO_GO',
    };
    const postStateProof = {
      phase: 'post_state',
      valid: true,
      requiresPostState: false,
      blockers: [],
      goNoGo: null,
    };

    const result = appendProofChainToReplay(enrichedStep, stepExecProof, postStateProof);

    expect(result.proofChain.stepExecutionValid).toBe(false);
    expect(result.proofChain.complete).toBe(false);
    expect(result.proofGoNoGo).toBe('NO_GO');
  });
});

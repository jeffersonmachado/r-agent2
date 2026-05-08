'use strict';

/**
 * evidenceProofValidator.test.js
 *
 * Testes da proof chain de evidência operacional.
 * Prova que endpoints reais foram chamados, mutações reais ocorreram,
 * side effects foram observados — e que validações incompletas geram NO_GO.
 */

const {
  validateEvidenceProof,
  validateNetworkProof,
  validateMutationProof,
  validateSideEffectProof,
  computeRealSnapshotDiff,
} = require('../../../qa/evidence/evidenceProofValidator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNetworkResponse(method, url, status) {
  return { type: 'response', method, url, status };
}

function makeStep(stepId, actionType, extra = {}) {
  return { id: stepId, actionType, ...extra };
}

// ---------------------------------------------------------------------------
// 1. computeRealSnapshotDiff
// ---------------------------------------------------------------------------

describe('computeRealSnapshotDiff', () => {
  test('before === after deve retornar changed:false e mutationCount:0', () => {
    const snap = { messages_count: 5, status: 'open' };
    const result = computeRealSnapshotDiff(snap, snap);
    expect(result.changed).toBe(false);
    expect(result.mutationCount).toBe(0);
  });

  test('before == after (deep equal mas objetos distintos) → changed:false', () => {
    const before = { messages_count: 3, status: 'open' };
    const after = { messages_count: 3, status: 'open' };
    const result = computeRealSnapshotDiff(before, after);
    expect(result.changed).toBe(false);
    expect(result.mutationCount).toBe(0);
  });

  test('messages_count incrementado → mutation detectada', () => {
    const before = { messages_count: 3, status: 'open' };
    const after = { messages_count: 4, status: 'open' };
    const result = computeRealSnapshotDiff(before, after);
    expect(result.changed).toBe(true);
    expect(result.mutationCount).toBeGreaterThan(0);
    expect(result.mutations.some((m) => m.includes('messages_count'))).toBe(true);
  });

  test('status changed → mutation detectada', () => {
    const before = { messages_count: 4, status: 'open' };
    const after = { messages_count: 4, status: 'resolved' };
    const result = computeRealSnapshotDiff(before, after);
    expect(result.changed).toBe(true);
    expect(result.mutations.some((m) => m.includes('status'))).toBe(true);
  });

  test('before null → changed:false, sem crash', () => {
    const result = computeRealSnapshotDiff(null, { messages_count: 1 });
    expect(result.changed).toBe(false);
    expect(result.mutationCount).toBe(0);
  });

  test('after null → changed:false, sem crash', () => {
    const result = computeRealSnapshotDiff({ messages_count: 1 }, null);
    expect(result.changed).toBe(false);
    expect(result.mutationCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. validateNetworkProof
// ---------------------------------------------------------------------------

describe('validateNetworkProof', () => {
  test('step_reply_ticket: evento POST correto → valid:true', () => {
    const events = [
      makeNetworkResponse('GET', '/api/other', 200),
      makeNetworkResponse('POST', '/tickets/abc123/reply', 201),
    ];
    const result = validateNetworkProof(events, 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(true);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  test('step_reply_ticket: evento POST com URL errada → NO_GO', () => {
    const events = [
      makeNetworkResponse('POST', '/tickets/abc123/messages', 201),
    ];
    const result = validateNetworkProof(events, 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.blockers.some((b) => b.reason === 'network_proof_missing_endpoint')).toBe(true);
  });

  test('step_reply_ticket: nenhum evento de rede → missing endpoint blocker', () => {
    const result = validateNetworkProof([], 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.reason === 'network_proof_missing_endpoint')).toBe(true);
  });

  test('step_change_status: PATCH correto → valid:true', () => {
    const events = [
      makeNetworkResponse('PATCH', '/tickets/xyz/status', 200),
    ];
    const result = validateNetworkProof(events, 'step_change_status', 'change_status');
    expect(result.valid).toBe(true);
  });

  test('step_change_status: PATCH ausente → NO_GO', () => {
    const events = [
      makeNetworkResponse('GET', '/tickets/xyz', 200),
    ];
    const result = validateNetworkProof(events, 'step_change_status', 'change_status');
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.reason === 'network_proof_missing_endpoint')).toBe(true);
  });

  test('actionType sem contrato → noContract:true, valid:true (pass-through)', () => {
    const result = validateNetworkProof([], 'step_navegacao_inicial', 'navigate');
    expect(result.valid).toBe(true);
    expect(result.noContract).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. validateMutationProof
// ---------------------------------------------------------------------------

describe('validateMutationProof', () => {
  test('before e after iguais → blocker mutation_proof_no_real_mutation', () => {
    const snap = { messages_count: 3, status: 'open' };
    const result = validateMutationProof(snap, snap, [], 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.reason === 'mutation_proof_no_real_mutation')).toBe(true);
  });

  test('messages_count unchanged → mutationCount 0 → blocker', () => {
    const before = { messages_count: 2, status: 'open' };
    const after = { messages_count: 2, status: 'open' };
    const result = validateMutationProof(before, after, [], 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(false);
    expect(result.mutationCount).toBe(0);
  });

  test('messages_count incrementado → valid:true (mutação real)', () => {
    const before = { messages_count: 2, status: 'open' };
    const after = { messages_count: 3, status: 'open' };
    const result = validateMutationProof(before, after, ['message_created'], 'step_reply_ticket', 'type_and_send');
    expect(result.diff.changed).toBe(true);
    expect(result.mutationCount).toBeGreaterThan(0);
  });

  test('beforeSnapshot null → blocker missing_before_snapshot', () => {
    const result = validateMutationProof(null, { messages_count: 3 }, [], 'step_reply_ticket', 'type_and_send');
    expect(result.blockers.some((b) => b.reason === 'mutation_proof_missing_before_snapshot')).toBe(true);
  });

  test('afterSnapshot null → blocker missing_after_snapshot', () => {
    const result = validateMutationProof({ messages_count: 2 }, null, [], 'step_reply_ticket', 'type_and_send');
    expect(result.blockers.some((b) => b.reason === 'mutation_proof_missing_after_snapshot')).toBe(true);
  });

  test('change_status: status unchanged → NO_GO', () => {
    const before = { status: 'open', messages_count: 2 };
    const after = { status: 'open', messages_count: 2 };
    const result = validateMutationProof(before, after, [], 'step_change_status', 'change_status');
    expect(result.valid).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. validateSideEffectProof
// ---------------------------------------------------------------------------

describe('validateSideEffectProof', () => {
  test('side effect esperado mas não observado → blocker side_effect_proof_not_observed', () => {
    const observed = ['other_event'];
    const result = validateSideEffectProof(observed, 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.blockers.some((b) => b.reason === 'side_effect_proof_not_observed')).toBe(true);
  });

  test('message_created observado → incluso em expected', () => {
    const observed = ['message_created', 'audit_log_created', 'crm_updated'];
    const result = validateSideEffectProof(observed, 'step_reply_ticket', 'type_and_send');
    expect(result.valid).toBe(true);
    expect(result.missing.length).toBe(0);
  });

  test('step sem contrato → noContract:true, valid:true', () => {
    const result = validateSideEffectProof([], 'step_navegacao_inicial', 'navigate');
    expect(result.valid).toBe(true);
    expect(result.noContract).toBe(true);
  });

  test('change_status: ticket_status_changed ausente → blocker', () => {
    const observed = ['audit_log_created'];
    const result = validateSideEffectProof(observed, 'step_change_status', 'change_status');
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('ticket_status_changed');
  });
});

// ---------------------------------------------------------------------------
// 5. validateEvidenceProof — proof chain completa
// ---------------------------------------------------------------------------

describe('validateEvidenceProof', () => {
  // ── reply_ticket ──────────────────────────────────────────────────────────

  describe('reply_ticket', () => {
    test('evento POST errado → NO_GO em blocking journey', () => {
      const step = makeStep('step_reply_ticket', 'type_and_send', {
        networkEvents: [makeNetworkResponse('POST', '/tickets/abc/messages', 201)],
        mutationLinkage: { observedMutations: ['message_created'] },
        sideEffectLinkage: { observedSideEffects: ['message_created', 'audit_log_created', 'crm_updated'] },
      });
      const before = { messages_count: 2 };
      const after = { messages_count: 3 };
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: before,
        afterSnapshot: after,
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.networkProof.valid).toBe(false);
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('endpoint ausente → NO_GO', () => {
      const step = makeStep('step_reply_ticket', 'type_and_send', { networkEvents: [] });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: { messages_count: 2 },
        afterSnapshot: { messages_count: 3 },
        networkEvents: [],
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.valid).toBe(false);
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('mutationCount = 0 → NO_GO', () => {
      const step = makeStep('step_reply_ticket', 'type_and_send', {
        networkEvents: [makeNetworkResponse('POST', '/tickets/abc/reply', 201)],
      });
      const snap = { messages_count: 2, status: 'open' };
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: snap,
        afterSnapshot: snap, // idêntico → mutationCount = 0
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.mutationProof.mutationCount).toBe(0);
      expect(result.valid).toBe(false);
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('messages_count unchanged → NO_GO', () => {
      const before = { messages_count: 3, status: 'open' };
      const after = { messages_count: 3, status: 'open' };
      const step = makeStep('step_reply_ticket', 'type_and_send', {
        networkEvents: [makeNetworkResponse('POST', '/tickets/abc/reply', 201)],
        mutationLinkage: { observedMutations: [] },
        sideEffectLinkage: { observedSideEffects: [] },
      });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: before,
        afterSnapshot: after,
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.realSnapshotDiff.changed).toBe(false);
      expect(result.valid).toBe(false);
    });
  });

  // ── change_status ─────────────────────────────────────────────────────────

  describe('change_status', () => {
    test('PATCH ausente → NO_GO', () => {
      const step = makeStep('step_change_status', 'change_status', {
        networkEvents: [makeNetworkResponse('GET', '/tickets/abc', 200)],
      });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: { status: 'open' },
        afterSnapshot: { status: 'resolved' },
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.networkProof.valid).toBe(false);
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('status unchanged → NO_GO', () => {
      const step = makeStep('step_change_status', 'change_status', {
        networkEvents: [makeNetworkResponse('PATCH', '/tickets/abc/status', 200)],
        mutationLinkage: { observedMutations: [] },
        sideEffectLinkage: { observedSideEffects: ['ticket_status_changed', 'audit_log_created'] },
      });
      const snap = { status: 'open', messages_count: 2 };
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: snap,
        afterSnapshot: snap,
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.realSnapshotDiff.changed).toBe(false);
      expect(result.valid).toBe(false);
    });
  });

  // ── checkin_submit ────────────────────────────────────────────────────────

  describe('checkin_submit', () => {
    test('AccessDecision ausente dos side effects → NO_GO', () => {
      const step = makeStep('step_identify_customer', 'checkin_submit', {
        networkEvents: [makeNetworkResponse('POST', '/api/fitness/checkin/identify', 200)],
        mutationLinkage: { observedMutations: ['access_decision_created'] },
        sideEffectLinkage: { observedSideEffects: [] }, // access_policy_evaluated ausente
      });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: { subject: null },
        afterSnapshot: { subject: { id: '123' } },
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.sideEffectProof.valid).toBe(false);
      expect(result.valid).toBe(false);
    });

    test('attendance missing → NO_GO (step_assert_attendance)', () => {
      const step = makeStep('step_assert_attendance', 'assert_attendance', {
        networkEvents: [],
        sideEffectLinkage: { observedSideEffects: ['crm_presence_updated'] }, // attendance_created ausente
      });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: { attendance_count: 0 },
        afterSnapshot: { attendance_count: 0 }, // sem mudança → NO_GO também por mutation
        networkEvents: [],
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.sideEffectProof.valid).toBe(false);
      expect(result.sideEffectProof.missing).toContain('attendance_created');
    });
  });

  // ── snapshot diff ─────────────────────────────────────────────────────────

  describe('realSnapshotDiff', () => {
    test('before == after (deep equal) → NO_GO em step mutacional', () => {
      const snap = { status: 'open', messages_count: 3 };
      const step = makeStep('step_change_status', 'change_status', {
        networkEvents: [makeNetworkResponse('PATCH', '/tickets/abc/status', 200)],
        sideEffectLinkage: { observedSideEffects: ['ticket_status_changed', 'audit_log_created'] },
      });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: snap,
        afterSnapshot: { ...snap },
        networkEvents: step.networkEvents,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.realSnapshotDiff.changed).toBe(false);
      expect(result.valid).toBe(false);
    });
  });

  // ── diagnostic mode ───────────────────────────────────────────────────────

  describe('diagnostic mode', () => {
    test('proof inválida em diagnostic → REVIEW (não NO_GO)', () => {
      const step = makeStep('step_reply_ticket', 'type_and_send', { networkEvents: [] });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: null,
        afterSnapshot: null,
        networkEvents: [],
        journeyContext: { isBlockingJourney: true, executionMode: 'diagnostic' },
      });
      expect(result.valid).toBe(false);
      expect(result.goNoGo).toBe('REVIEW');
    });
  });

  // ── non-blocking journey ──────────────────────────────────────────────────

  describe('non-blocking journey', () => {
    test('proof inválida mas não-blocking → goNoGo null', () => {
      const step = makeStep('step_reply_ticket', 'type_and_send', { networkEvents: [] });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: null,
        afterSnapshot: null,
        networkEvents: [],
        journeyContext: { isBlockingJourney: false, executionMode: 'operational_go' },
      });
      expect(result.goNoGo).toBeNull();
    });
  });

  // ── navigate (sem contrato) ───────────────────────────────────────────────

  describe('navigate (sem contrato de proof)', () => {
    test('step navigate sem network events → valid:true (sem contrato)', () => {
      const step = makeStep('step_access_support', 'navigate', { networkEvents: [] });
      const result = validateEvidenceProof({
        step,
        beforeSnapshot: null,
        afterSnapshot: null,
        networkEvents: [],
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });
      expect(result.valid).toBe(true);
      expect(result.networkProof.noContract).toBe(true);
    });
  });
});

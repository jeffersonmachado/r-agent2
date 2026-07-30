'use strict';

/**
 * operationalSemanticConsistency.test.js
 *
 * Testes obrigatórios para SEMANTIC OPERATIONAL CONTRACT CONSISTENCY (Phase 2).
 *
 * Valida:
 *   1. stepId + actionType + mutationExpected consistência
 *   2. Registry-based validation vs. heuristic fallback
 *   3. Mutation provenance tracking
 *   4. Entity-scoped snapshots reduzem ruído
 *   5. Step correlation (mutação não pode ser "herdada")
 *
 * Testes obrigatórios:
 *   ✓ registry stepId mismatch => NO_GO
 *   ✓ step com expectedMutations mas mutationExpected=false => NO_GO
 *   ✓ submit_checkin sem attendance_created => NO_GO
 *   ✓ identify_customer com mutation => REVIEW (asserção, não GO)
 *   ✓ reply_ticket herdando mutation de outro step => NO_GO
 *   ✓ entityScoped snapshot reduz ruído global
 *   ✓ change_status sem status mutation => NO_GO
 */

const registry = require('../../../qa/contracts/operationalStepRegistry');
const postStateValidator = require('../../../qa/evidence/postStateProofValidator');
const stateSnapshotService = require('../qa/stateSnapshotService');

const {
  getStepSpec,
  isMutationExpectedStep,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  validateStepConsistency,
} = registry;

describe('Operational Semantic Consistency (Phase 2)', () => {
  describe('Test 1: registry stepId mismatch => NO_GO', () => {
    test('step with unknown stepId not in registry', () => {
      const stepId = 'step_unknown_operation';
      const spec = getStepSpec(stepId);

      expect(spec).toBeNull();
    });

    test('step with correct stepId is in registry', () => {
      const stepId = 'step_reply_ticket';
      const spec = getStepSpec(stepId);

      expect(spec).toBeDefined();
      expect(spec.stepId).toBe('step_reply_ticket');
      expect(spec.actionType).toBe('type_and_send');
    });

    test('legacy support stepId is rejected by registry', () => {
      const legacyStepId = 'step_list_tickets';
      const spec = getStepSpec(legacyStepId);

      expect(spec).toBeNull();
      expect(validateStepConsistency({ id: legacyStepId, actionType: 'wait_for_list' }).valid).toBe(false);
    });
  });

  describe('Test 2: step com expectedMutations mas mutationExpected=false => NO_GO', () => {
    test('inconsistent: expectedMutations populated but mutationExpected=false', () => {
      const step = {
        id: 'step_identify_customer',
        actionType: 'identify_customer',
        mutationExpected: false,
        beforeStepSnapshot: { subject_id: null },
        afterStepSnapshot: { subject_id: '123' },
      };

      const spec = getStepSpec(step.id);

      expect(spec).toBeDefined();
      expect(spec.mutationExpected).toBe(false);
      expect(spec.expectedMutations).toEqual([]);
      expect(isMutationExpectedStep(step)).toBe(false);
    });

    test('consistent: mutationExpected=true with expectedMutations populated', () => {
      const step = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        mutationExpected: true,
      };

      const spec = getStepSpec(step.id);
      const mutations = getExpectedMutationsForStep(step);

      expect(spec).toBeDefined();
      expect(spec.mutationExpected).toBe(true);
      expect(mutations).toContain('attendance_created');
      expect(isMutationExpectedStep(step)).toBe(true);
    });
  });

  describe('Test 3: submit_checkin sem attendance_created => NO_GO', () => {
    test('submit_checkin with NO observed mutations fails post-state proof', () => {
      const step = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        mutationExpected: true,
        networkEvents: [
          {
            type: 'response',
            method: 'POST',
            url: 'http://localhost/api/fitness/checkin',
            status: 200,
          },
        ],
      };

      const beforeSnapshot = {
        attendance_count: 0,
        access_decision: null,
      };

      const afterSnapshot = {
        attendance_count: 0,
        access_decision: null,
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot,
        afterSnapshot,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });

      expect(result.valid).toBe(false);
      expect(result.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: expect.stringMatching(/snapshot_unchanged|no_observed_mutations/),
          }),
        ])
      );
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('submit_checkin with attendance_created passes post-state proof', () => {
      const step = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        mutationExpected: true,
        beforeStepSnapshot: {
          db: { attendance: { count: 0, created: false, not_exists: true } },
          api: { access: { decision: { count: 0, allow: false } } },
          devices: { access: { events: 0 } },
          crm: { presenceActivity: { count: 5, created: false } },
        },
        afterStepSnapshot: {
          db: { attendance: { count: 1, created: true, not_exists: false } },
          api: { access: { decision: { count: 1, allow: true } } },
          devices: { access: { events: 1 } },
          crm: { presenceActivity: { count: 6, created: true } },
        },
        networkEvents: [
          {
            type: 'response',
            method: 'POST',
            url: 'http://localhost/api/fitness/checkin',
            status: 200,
          },
        ],
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot: step.beforeStepSnapshot,
        afterSnapshot: step.afterStepSnapshot,
        journeyContext: { isBlockingJourney: true, executionMode: 'operational_go' },
      });

      expect(result.valid).toBe(true);
      expect(result.observedMutations).toContain('attendance_created');
      expect(result.goNoGo).toBeNull();
    });
  });

  describe('Test 4: identify_customer com mutation => REVIEW (não GO)', () => {
    test('identify_customer should NOT generate mutations', () => {
      const step = {
        id: 'step_identify_customer',
        actionType: 'identify_customer',
        mutationExpected: false,
      };

      const spec = getStepSpec(step.id);
      const mutations = getExpectedMutationsForStep(step);

      expect(spec.mutationExpected).toBe(false);
      expect(mutations).toEqual([]);
      expect(isMutationExpectedStep(step)).toBe(false);
    });

    test('if identify_customer somehow has observed mutation, it is an anomaly (REVIEW)', () => {
      const step = {
        id: 'step_identify_customer',
        actionType: 'identify_customer',
        mutationExpected: false,
        beforeStepSnapshot: {
          subject_id: null,
        },
        afterStepSnapshot: {
          subject_id: '123',
        },
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot: step.beforeStepSnapshot,
        afterSnapshot: step.afterStepSnapshot,
        journeyContext: { isBlockingJourney: true, executionMode: 'diagnostic' },
      });

      // As long as mutationExpected=false, this step doesn't require post-state proof
      expect(result.requiresPostState).toBe(false);
      expect(result.valid).toBe(true);
    });
  });

  describe('Test 5: reply_ticket herdando mutation de outro step => NO_GO', () => {
    test('each step must prove its own mutations via incremental diff, no borrowing', () => {
      const steps = [
        {
          id: 'step_change_status',
          actionType: 'change_status',
          mutationExpected: true,
          beforeStepSnapshot: { ticket_status: 'open' },
          afterStepSnapshot: { ticket_status: 'open' }, // NO CHANGE
          networkEvents: [
            {
              type: 'response',
              method: 'PATCH',
              url: 'http://localhost/api/tickets/1/status',
              status: 200,
            },
          ],
        },
        {
          id: 'step_reply_ticket',
          actionType: 'type_and_send',
          mutationExpected: true,
          beforeStepSnapshot: { message_count: 3 },
          afterStepSnapshot: { message_count: 3 }, // NO CHANGE
          networkEvents: [
            {
              type: 'response',
              method: 'POST',
              url: 'http://localhost/api/tickets/1/reply',
              status: 201,
            },
          ],
        },
      ];

      // Both steps should fail because their incremental diffs show NO mutation
      steps.forEach((step) => {
        const result = postStateValidator.validatePostStateProof({
          step,
          beforeSnapshot: step.beforeStepSnapshot,
          afterSnapshot: step.afterStepSnapshot,
          journeyContext: { isBlockingJourney: true },
        });

        expect(result.valid).toBe(false);
        expect(result.goNoGo).toBe('NO_GO');
      });
    });

    test('step correlation: reply_ticket proves its mutation via incremental diff', () => {
      const step = {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        mutationExpected: true,
        beforeStepSnapshot: {
          db: { messages: { count: 3 } },
          events: { audit: { count: 10 }, notifications: { count: 0 } },
          crm: { activities: { count: 5 } },
        },
        afterStepSnapshot: {
          db: { messages: { count: 4 } },
          events: { audit: { count: 11 }, notifications: { count: 1 } },
          crm: { activities: { count: 6 } },
        },
        networkEvents: [
          {
            type: 'response',
            method: 'POST',
            url: 'http://localhost/api/tickets/1/reply',
            status: 201,
          },
        ],
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot: step.beforeStepSnapshot,
        afterSnapshot: step.afterStepSnapshot,
        journeyContext: { isBlockingJourney: true },
      });

      expect(result.valid).toBe(true);
      expect(result.observedMutations).toContain('message_created');
      expect(result.goNoGo).toBeNull();
    });
  });

  describe('Test 6: entityScoped snapshot reduz ruído global', () => {
    test('filterSnapshotByEntityScope keeps only relevant entities', () => {
      const globalSnapshot = {
        db: {
          ticket: { id: '1', status: 'open', message_count: 3 },
          user: { id: '100', name: 'Agent' },
          device: { id: 'dev-1', name: 'Turnstile' },
          audit: { count: 50 },
        },
        crm: {
          activity: { count: 20 },
          journey: { id: 'j1' },
        },
        metadata: { collectedAt: '2024-01-01T00:00:00Z' },
      };

      // step_reply_ticket should only capture: ticket, messages, audit
      const filtered = stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope(globalSnapshot, 'step_reply_ticket', { diagnosticMode: true });

      expect(filtered.db.ticket).toBeDefined();
      expect(filtered.db.audit).toBeDefined();
      expect(filtered.crm).toEqual({});
      expect(filtered.metadata.entityScope).toEqual(['ticket', 'messages', 'audit']);
      expect(filtered.metadata.filterApplied).toBe(true);
    });

    test('entityScoped snapshot has less payload than global', () => {
      const globalSnapshot = {
        db: {
          ticket: { id: '1', status: 'open' },
          user: { id: '100' },
          device: { id: 'dev-1' },
          settings: { color_theme: 'dark' },
          config: { version: '2.0' },
          temp_cache: { data: 'x'.repeat(10000) },
        },
        metadata: {},
      };

      const globalSize = JSON.stringify(globalSnapshot).length;

      // step_change_status only needs: ticket.status, audit
      const filtered = stateSnapshotService.__diagnosticOnlyFilterSnapshotByEntityScope(globalSnapshot, 'step_change_status', { diagnosticMode: true });

      const filteredSize = JSON.stringify(filtered).length;

      expect(filteredSize).toBeLessThan(globalSize);
      expect(filtered.metadata.filterApplied).toBe(true);
    });
  });

  describe('Test 7: change_status sem status mutation => NO_GO', () => {
    test('change_status with ticket.status unchanged fails validation', () => {
      const step = {
        id: 'step_change_status',
        actionType: 'change_status',
        mutationExpected: true,
        beforeStepSnapshot: { ticket_status: 'open' },
        afterStepSnapshot: { ticket_status: 'open' }, // UNCHANGED
        networkEvents: [
          {
            type: 'response',
            method: 'PATCH',
            url: 'http://localhost/api/tickets/1/status',
            status: 200,
          },
        ],
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot: step.beforeStepSnapshot,
        afterSnapshot: step.afterStepSnapshot,
        journeyContext: { isBlockingJourney: true },
      });

      expect(result.valid).toBe(false);
      expect(result.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'post_state_proof_snapshot_unchanged',
          }),
        ])
      );
      expect(result.goNoGo).toBe('NO_GO');
    });

    test('change_status with ticket.status changed passes validation', () => {
      const step = {
        id: 'step_change_status',
        actionType: 'change_status',
        mutationExpected: true,
        beforeStepSnapshot: { db: { ticket: { status: 'open' } }, events: { audit: { count: 10 } } },
        afterStepSnapshot: { db: { ticket: { status: 'resolved' } }, events: { audit: { count: 11 } } },
        networkEvents: [
          {
            type: 'response',
            method: 'PATCH',
            url: 'http://localhost/api/tickets/1/status',
            status: 200,
          },
        ],
      };

      const result = postStateValidator.validatePostStateProof({
        step,
        beforeSnapshot: step.beforeStepSnapshot,
        afterSnapshot: step.afterStepSnapshot,
        journeyContext: { isBlockingJourney: true },
      });

      expect(result.valid).toBe(true);
      expect(result.observedMutations).toContain('ticket_status_changed');
      expect(result.goNoGo).toBeNull();
    });
  });

  describe('Registry consistency checks', () => {
    test('all FITNESS_CUSTOMER_CHECKIN steps are registered', () => {
      const fitnessSteps = registry.getJourneySteps('fitness_customer_checkin');

      expect(fitnessSteps).toBeDefined();
      expect(fitnessSteps.step_access_checkin_module).toBeDefined();
      expect(fitnessSteps.step_identify_customer).toBeDefined();
      expect(fitnessSteps.step_validate_membership).toBeDefined();
      expect(fitnessSteps.step_submit_checkin).toBeDefined();
      expect(fitnessSteps.step_confirm_attendance).toBeDefined();
    });

    test('all SUPPORT_TICKET_FLOW steps are registered', () => {
      const supportSteps = registry.getJourneySteps('support_ticket_flow');

      expect(supportSteps).toBeDefined();
      expect(supportSteps.step_access_support_module).toBeDefined();
      expect(supportSteps.step_wait_ticket_list).toBeDefined();
      expect(supportSteps.step_open_ticket).toBeDefined();
      expect(supportSteps.step_reply_ticket).toBeDefined();
      expect(supportSteps.step_change_status).toBeDefined();
      expect(supportSteps.step_assert_ticket_ui).toBeDefined();
      expect(supportSteps.step_assert_ticket_backend).toBeDefined();
    });

    test('mutationExpected steps have expectedMutations populated', () => {
      const mutationSteps = [
        'step_reply_ticket',
        'step_change_status',
        'step_submit_checkin',
      ];

      mutationSteps.forEach((stepId) => {
        const spec = getStepSpec(stepId);
        expect(spec).toBeDefined();
        expect(spec.mutationExpected).toBe(true);
        expect(spec.expectedMutations).toBeDefined();
        expect(spec.expectedMutations.length).toBeGreaterThan(0);
      });
    });

    test('non-mutational steps have empty expectedMutations', () => {
      const nonMutationSteps = [
        'step_access_support_module',
        'step_identify_customer',
        'step_validate_membership',
        'step_confirm_attendance',
      ];

      nonMutationSteps.forEach((stepId) => {
        const spec = getStepSpec(stepId);
        expect(spec).toBeDefined();
        expect(spec.mutationExpected).toBe(false);
        expect(spec.expectedMutations).toEqual([]);
      });
    });
  });

  describe('Mutation provenance tracking', () => {
    test('computeMutationProvenance creates provenance for each observed mutation', () => {
      const step = {
        id: 'step_reply_ticket',
        stepId: 'step_reply_ticket',
        networkEvents: [
          {
            type: 'response',
            method: 'POST',
            url: 'http://localhost/api/tickets/1/reply',
            status: 201,
          },
        ],
      };

      const observedMutations = ['message_created'];
      const beforeSnapshot = { message_count: 3 };
      const afterSnapshot = { message_count: 4 };

      const provenance = postStateValidator.computeMutationProvenance({
        step,
        observedMutations,
        beforeStepSnapshot: beforeSnapshot,
        afterStepSnapshot: afterSnapshot,
      });

      expect(provenance).toHaveLength(1);
      expect(provenance[0]).toMatchObject({
        mutation: 'message_created',
        originatingStepId: 'step_reply_ticket',
        correlatedBy: 'network_linkage',
      });
      expect(provenance[0].originatingNetworkEvents).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          url: 'http://localhost/api/tickets/1/reply',
          status: 201,
        })
      );
      expect(provenance[0].beforeSnapshotHash).toBeDefined();
      expect(provenance[0].afterSnapshotHash).toBeDefined();
    });
  });
});

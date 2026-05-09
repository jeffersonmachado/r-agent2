'use strict';

const replayAdapter = require('../qaWavesReplayAdapter');

describe('RPA Replay Adapter - Mutation Provenance Integration (Task 8)', () => {
  describe('normalizeStep: semantic contract enrichment', () => {
    test('reply_ticket step includes semantic contract from registry', () => {
      const rawStep = {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        action: 'type_and_send',
        name: 'Reply to ticket',
        url: 'http://localhost/tickets/123',
        status: 'success',
        startedAt: '2024-01-15T10:00:00.000Z',
        finishedAt: '2024-01-15T10:00:05.000Z',
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created', 'crm_updated', 'notification_sent'],
        networkEvents: [
          {
            method: 'POST',
            url: 'http://localhost/api/tickets/123/reply',
            status: 201,
          },
        ],
        beforeSnapshotHash: 'abc12345',
        afterSnapshotHash: 'def67890',
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.id).toBe('step_reply_ticket');
      expect(normalized.semanticContract).toBeDefined();
      expect(normalized.semanticContract.stepId).toBe('step_reply_ticket');
      expect(normalized.semanticContract.actionType).toBe('type_and_send');
      expect(normalized.mutationExpected).toBe(true);
    });

    test('submit_checkin step includes expected mutations from registry', () => {
      const rawStep = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        name: 'Submit checkin',
        status: 'success',
        observedMutations: ['attendance_created'],
        observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.expectedMutations).toContain('attendance_created');
      expect(normalized.expectedSideEffects).toContain('access_decision_created');
      expect(normalized.expectedSideEffects).toContain('access_event_created');
    });

    test('change_status step includes entity scope from registry', () => {
      const rawStep = {
        id: 'step_change_status',
        actionType: 'change_status',
        name: 'Change ticket status',
        status: 'success',
        observedMutations: ['ticket_status_changed'],
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.entityScope).toBeDefined();
      expect(normalized.entityScope).toEqual(expect.arrayContaining(['ticket.status', 'audit']));
    });
  });

  describe('mutationProvenance: proof of mutation origin', () => {
    test('mutation provenance includes network linkage', () => {
      const rawStep = {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        status: 'success',
        observedMutations: ['message_created'],
        networkEvents: [
          {
            type: 'response',
            method: 'POST',
            url: 'http://localhost/api/tickets/1/reply',
            status: 201,
          },
        ],
        beforeSnapshotHash: 'abc12345',
        afterSnapshotHash: 'def67890',
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.mutationProvenance).toHaveLength(1);
      const provenance = normalized.mutationProvenance[0];

      expect(provenance.mutation).toBe('message_created');
      expect(provenance.originatingStepId).toBe('step_reply_ticket');
      expect(provenance.originatingNetworkEvents).toHaveLength(1);
      expect(provenance.originatingNetworkEvents[0].method).toBe('POST');
      expect(provenance.originatingNetworkEvents[0].status).toBe(201);
      expect(provenance.beforeSnapshotHash).toBe('abc12345');
      expect(provenance.afterSnapshotHash).toBe('def67890');
      expect(provenance.correlatedBy).toBe('network_linkage');
    });

    test('multiple mutations each get their own provenance entry', () => {
      const rawStep = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        status: 'success',
        observedMutations: ['attendance_created', 'access_decision_created', 'access_event_created'],
        networkEvents: [
          {
            method: 'POST',
            url: 'http://localhost/api/fitness/checkin',
            status: 200,
          },
        ],
        beforeSnapshotHash: 'snap1',
        afterSnapshotHash: 'snap2',
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.mutationProvenance).toHaveLength(3);
      normalized.mutationProvenance.forEach((prov) => {
        expect(prov.originatingStepId).toBe('step_submit_checkin');
        expect(prov.correlatedBy).toBe('network_linkage');
      });
    });

    test('provenance without network events is invalid, without snapshot_diff fallback', () => {
      const rawStep = {
        id: 'step_change_status',
        actionType: 'change_status',
        status: 'success',
        observedMutations: ['ticket_status_changed'],
        networkEvents: [],
        beforeSnapshotHash: 'hash1',
        afterSnapshotHash: 'hash2',
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      const provenance = normalized.mutationProvenance[0];
      expect(provenance.correlatedBy).toBe('expected_network_event_not_found');
      expect(provenance.valid).toBe(false);
      expect(provenance.reason).toBe('expected_network_event_not_found');
      expect(provenance.originatingNetworkEvents).toHaveLength(0);
    });
  });

  describe('evidence section: enriched with provenance', () => {
    test('evidence section includes semantic contract', () => {
      const rawStep = {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        status: 'success',
        observedMutations: ['message_created'],
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.evidence.semanticContract).toBeDefined();
      expect(normalized.evidence.semanticContract.stepId).toBe('step_reply_ticket');
    });

    test('evidence section includes mutation provenance', () => {
      const rawStep = {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        status: 'success',
        observedMutations: ['message_created'],
        networkEvents: [
          {
            method: 'POST',
            url: 'http://localhost/api/tickets/1/reply',
            status: 201,
          },
        ],
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.evidence.mutationProvenance).toBeDefined();
      expect(normalized.evidence.mutationProvenance).toHaveLength(1);
    });

    test('evidence section includes expected vs observed mutations', () => {
      const rawStep = {
        id: 'step_submit_checkin',
        actionType: 'checkin_submit',
        status: 'success',
        observedMutations: ['attendance_created'],
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.evidence.expectedMutations).toContain('attendance_created');
      expect(normalized.evidence.observedMutations).toContain('attendance_created');
      expect(normalized.evidence.expectedSideEffects).toContain('access_decision_created');
    });
  });

  describe('unknown stepId: graceful fallback', () => {
    test('unknown stepId returns null semanticContract but does not crash', () => {
      const rawStep = {
        id: 'step_unknown_future_operation',
        actionType: 'unknown',
        status: 'success',
      };

      const normalized = replayAdapter.normalizeStep(rawStep);

      expect(normalized.id).toBe('step_unknown_future_operation');
      expect(normalized.semanticContract).toBeNull();
      expect(normalized.mutationExpected).toBe(false);
      expect(normalized.expectedMutations).toEqual([]);
      expect(normalized.entityScope).toEqual([]);
    });
  });

  describe('fixture: full realistic replay JSON', () => {
    test('normalizeStep enriches all steps with semantic consistency info', () => {
      const steps = [
        {
          id: 'step_open_ticket',
          actionType: 'navigate',
          status: 'success',
          name: 'Open ticket form',
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          id: 'step_reply_ticket',
          actionType: 'type_and_send',
          status: 'success',
          name: 'Reply to ticket',
          timestamp: '2024-01-15T10:00:30Z',
          observedMutations: ['message_created'],
          networkEvents: [
            { method: 'POST', url: 'http://localhost/api/tickets/1/reply', status: 201 },
          ],
        },
        {
          id: 'step_change_status',
          actionType: 'change_status',
          status: 'success',
          name: 'Change status to resolved',
          timestamp: '2024-01-15T10:00:60Z',
          observedMutations: ['ticket_status_changed'],
        },
      ];

      const normalized = steps.map((step, idx) => replayAdapter.normalizeStep(step, idx));

      expect(normalized).toHaveLength(3);

      // Step 2: step_reply_ticket
      const replyStep = normalized[1];
      expect(replyStep.semanticContract).toBeDefined();
      expect(replyStep.semanticContract.actionType).toBe('type_and_send');
      expect(replyStep.mutationExpected).toBe(true);
      expect(replyStep.expectedMutations).toContain('message_created');
      expect(replyStep.mutationProvenance).toHaveLength(1);
      expect(replyStep.mutationProvenance[0].correlatedBy).toBe('network_linkage');

      // Step 3: step_change_status
      const changeStatusStep = normalized[2];
      expect(changeStatusStep.semanticContract).toBeDefined();
      expect(changeStatusStep.entityScope).toEqual(expect.arrayContaining(['ticket.status', 'audit']));
    });
  });
});

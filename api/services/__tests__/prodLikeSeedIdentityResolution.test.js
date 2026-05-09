'use strict';

const stateSnapshotService = require('../qa/stateSnapshotService');
const {
  __testOnlyResolveSupportSeedMetadata,
  __testOnlyBuildSupportApiFallbackSnapshot,
  __testOnlyBuildFitnessApiFallbackSnapshot,
} = require('../../../scripts/smoke/qa-waves-operational-final-smoke');

describe('prod-like seed identity resolution', () => {
  test('normalizeSnapshotContext preserves aliases from seedEvidence and provision', () => {
    const normalized = stateSnapshotService.__testOnlyNormalizeSnapshotContext({
      journeyId: 'fitness_customer_checkin',
      seedEvidence: {
        conversation_id: 'conv-seed',
        customerId: 'customer-seed',
        subject_id: 'subject-seed',
        membership_id: 'membership-seed',
        credential_id: 'credential-seed',
        device_id: 'device-seed',
        device_mode: 'test_device',
        provision: {
          contact_id: 'contact-provision',
        },
      },
    });

    expect(normalized.conversationId).toBe('conv-seed');
    expect(normalized.contactId).toBe('customer-seed');
    expect(normalized.subjectId).toBe('subject-seed');
    expect(normalized.membershipId).toBe('membership-seed');
    expect(normalized.credentialId).toBe('credential-seed');
    expect(normalized.deviceId).toBe('device-seed');
    expect(normalized.deviceMode).toBe('test_device');
  });

  test('support seed metadata falls back to ticket messages when detail lacks conversationId', () => {
    const resolved = __testOnlyResolveSupportSeedMetadata(
      {
        id: 'ticket-1',
        customer_id: 'customer-1',
        context: { customerId: 'customer-ctx' },
      },
      [{ conversation_id: 'conv-from-message' }],
    );

    expect(resolved.ticketId).toBe('ticket-1');
    expect(resolved.conversationId).toBe('conv-from-message');
    expect(resolved.contactId).toBe('customer-1');
  });

  test('support API fallback snapshot recovers ticket identity and message/audit counters when DB snapshot is empty', () => {
    const snapshot = __testOnlyBuildSupportApiFallbackSnapshot({
      stepId: 'step_reply_ticket',
      baseSnapshot: {
        state: null,
        db: {
          ticket: { exists: false, id: null, status: null, updatedAt: null },
          ticketStatus: null,
          messages: { count: 0 },
        },
        api: {
          support: { ticketId: 'ticket-1', conversationId: null },
        },
        events: {
          messages: { count: 0, available: true },
          audit: { count: 0, auditEventsAvailable: true, auditLogsAvailable: true },
          notifications: { count: 0, sent: 0, available: true },
        },
        crm: {
          activities: { count: 0, source: 'VerticalJourneyEvent', available: true },
        },
        metadata: {
          sources: { db: true, support: true, messages: true, audit: true, crm: true, notifications: true },
          sourceErrors: [],
          entityScope: ['ticket', 'messages', 'audit'],
          filterApplied: false,
          collector: 'entity_scoped',
          stepId: 'step_reply_ticket',
        },
      },
      ticket: {
        id: 'ticket-1',
        status: 'in_progress',
        updated_at: '2026-05-09T04:00:00.000Z',
        customer_id: 'customer-1',
      },
      messagesPayload: {
        timeline: [
          { id: 'msg-1', direction: 'in', body: { text: 'olá' } },
          { id: 'msg-2', direction: 'out', body: { text: 'resposta' }, conversation_id: 'conv-1' },
        ],
      },
      auditPayload: {
        items: [{ id: 'audit-1' }],
      },
    });

    expect(snapshot.db.ticket.exists).toBe(true);
    expect(snapshot.db.ticket.id).toBe('ticket-1');
    expect(snapshot.db.ticket.status).toBe('in_progress');
    expect(snapshot.db.messages.count).toBe(2);
    expect(snapshot.api.support.conversationId).toBe('conv-1');
    expect(snapshot.events.messages.count).toBe(2);
    expect(snapshot.events.audit.count).toBe(1);
    expect(snapshot.metadata.sources.supportApi).toBe(true);
  });

  test('fitness API fallback snapshot recovers canonical attendance, decision, event and timeline counts when entity-scoped DB snapshot is empty', () => {
    const snapshot = __testOnlyBuildFitnessApiFallbackSnapshot({
      stepId: 'step_submit_checkin',
      deviceId: 'device-1',
      baseSnapshot: {
        state: null,
        db: {
          attendance: { count: 0, created: false, not_exists: true },
        },
        api: {
          access: {
            decision: { count: 0, allow: false },
          },
        },
        events: {
          access: { count: 0, available: true },
        },
        crm: {
          presenceActivity: { count: 0, created: false },
        },
        devices: {
          mode: 'test_device',
          access: { decisions: 0, events: 0, releaseEventCreated: false },
        },
        metadata: {
          sources: { db: true, attendance: true, accessDecision: true, accessEvent: true, crm: true },
          sourceErrors: [],
          entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
          filterApplied: false,
          collector: 'entity_scoped',
          stepId: 'step_submit_checkin',
        },
      },
      decisionsPayload: {
        items: [{ id: 'decision-1' }],
      },
      eventsPayload: {
        items: [{ id: 'event-1' }],
      },
      attendancePayload: {
        items: [{ id: 'attendance-1' }],
      },
      timelinePayload: {
        items: [{ id: 'timeline-1' }],
      },
    });

    expect(snapshot.state).toBe('attendance_created');
    expect(snapshot.db.attendance.count).toBe(1);
    expect(snapshot.api.access.decision.count).toBe(1);
    expect(snapshot.events.access.count).toBe(1);
    expect(snapshot.crm.presenceActivity.count).toBe(1);
    expect(snapshot.devices.access.decisions).toBe(1);
    expect(snapshot.devices.access.events).toBe(1);
    expect(snapshot.metadata.sources.fitnessApi).toBe(true);
  });

  test('fitness entity-scoped snapshot falls back to subject-level evidence when strict device filters miss real records', async () => {
    const models = {
      AccessSubject: () => ({
        findOne: jest.fn().mockResolvedValue({ id: 'subject-1', membership_id: 'membership-1', customer_id: 'customer-1' }),
      }),
      AccessMembership: () => ({
        findOne: jest.fn().mockResolvedValue({ id: 'membership-1', status: 'active', billing_status: 'active' }),
      }),
      AccessCredential: () => ({
        findOne: jest.fn().mockResolvedValue({ id: 'credential-1', status: 'active' }),
      }),
      AccessDecision: () => ({
        count: jest.fn().mockImplementation(async ({ where }) => (
          where?.device_id ? 0 : 1
        )),
      }),
      AccessEvent: () => ({
        count: jest.fn().mockImplementation(async ({ where }) => (
          where?.device_id ? 0 : 1
        )),
      }),
      VerticalAttendance: () => ({
        count: jest.fn().mockImplementation(async ({ where }) => (
          where?.device_id || where?.membership_id ? 0 : 1
        )),
      }),
      VerticalJourneyEvent: () => ({
        count: jest.fn().mockImplementation(async ({ where }) => (
          where?.membership_id ? 0 : 1
        )),
      }),
    };

    const snapshot = await stateSnapshotService.collectEntityScopedSnapshot({
      journeyId: 'fitness_customer_checkin',
      stepId: 'step_submit_checkin',
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      contactId: 'customer-1',
      membershipId: 'membership-1',
      credentialId: 'credential-1',
      deviceId: 'device-1',
      deviceMode: 'test_device',
      models,
    });

    expect(snapshot.db.attendance.count).toBe(1);
    expect(snapshot.api.access.decision.count).toBe(1);
    expect(snapshot.events.access.count).toBe(1);
    expect(snapshot.crm.presenceActivity.count).toBe(1);
    expect(snapshot.metadata.filterApplied).toBe(true);
  });
});
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getAllExecutions: jest.fn(),
  queueMeshRun: jest.fn(() => ({ executionId: 'exec-1' })),
  getQueuedExecutionStatus: jest.fn(),
  logger: { warn: jest.fn() },
}));

describe('qaWavesExecutionService operational integration', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.isolateModules(() => {
      service = require('../qaWavesExecutionService');
    });
  });

  test('buildSnapshotContext propaga IDs provisionados da seed para o snapshot', () => {
    const context = service.buildSnapshotContext({
      replayId: 'replay-1',
      scenario: { id: 'scenario-1', journeyId: 'support_ticket_flow' },
      seed: {
        id: 'seed-1',
        data: {},
        seedEvidence: {
          provision: {
            ticketId: 'ticket-1',
            conversationId: 'conv-1',
            contactId: 'contact-1',
          },
        },
      },
      payload: { executionId: 'exec-1', seedEvidence: { provision: { ticketId: 'ticket-1', conversationId: 'conv-1', contactId: 'contact-1' } } },
    }, 'before', {});

    expect(context.ticketId).toBe('ticket-1');
    expect(context.conversationId).toBe('conv-1');
    expect(context.contactId).toBe('contact-1');
  });

  test('buildSnapshotContext prioriza seed e evidence atualizados do replay corrente', () => {
    const context = service.buildSnapshotContext({
      replayId: 'replay-1',
      scenario: { id: 'scenario-1', journeyId: 'support_ticket_flow' },
      seed: {
        id: 'seed-1',
        data: { conversationId: null, subjectId: null },
        seedEvidence: {
          provision: {
            conversationId: null,
            subjectId: null,
          },
        },
      },
      payload: {
        executionId: 'exec-1',
        seedEvidence: { provision: { conversationId: null, subjectId: null } },
      },
    }, 'before', {
      scenario: { journeyId: 'support_ticket_flow' },
      seed: {
        data: { conversationId: 'conv-live', subjectId: 'subject-live' },
        seedEvidence: {
          provision: { conversationId: 'conv-live', subjectId: 'subject-live' },
        },
      },
      payload: {
        seedEvidence: {
          provision: { conversationId: 'conv-live', subjectId: 'subject-live' },
        },
      },
    });

    expect(context.conversationId).toBe('conv-live');
    expect(context.subjectId).toBe('subject-live');
  });

  test('support blocking sem httpClient retorna seed missing e blocker operacional', async () => {
    const prepared = await service.prepareOperationalSeedEntry({
      scenario: { id: 'scenario-support', journeyId: 'support_ticket_flow' },
      seed: null,
    }, 'tenant-1', null);

    expect(prepared.seed.operationalSeedStatus).toBe('missing');
    expect(prepared.preExecutionBlockers.some((item) => item.reason === 'operational_seed_http_client_unavailable')).toBe(true);
  });

  test('fitness blocking sem httpClient retorna seed missing e blocker operacional', async () => {
    const prepared = await service.prepareOperationalSeedEntry({
      scenario: { id: 'scenario-fitness', journeyId: 'fitness_customer_checkin' },
      seed: null,
    }, 'tenant-1', null);

    expect(prepared.seed.operationalSeedStatus).toBe('missing');
    expect(prepared.preExecutionBlockers.some((item) => item.reason === 'operational_seed_http_client_unavailable')).toBe(true);
  });

  test('support seed provisionada injeta IDs e evidence pronta', async () => {
    const httpClient = jest.fn(async (request) => {
      if (request.url === '/api/crm/contacts') {
        return { ok: true, body: { id: 'contact-1' } };
      }
      if (request.url === '/tickets') {
        return {
          ok: true,
          body: { ticket: { id: 'ticket-1', conversationId: 'conv-1' } },
        };
      }
      if (request.url === '/tickets/ticket-1/takeover') {
        return { ok: true, body: { ok: true } };
      }
      return { ok: false, body: null };
    });

    const prepared = await service.prepareOperationalSeedEntry({
      scenario: { id: 'scenario-support', journeyId: 'support_ticket_flow' },
      seed: { id: 'seed-support', data: {} },
    }, 'tenant-1', httpClient);

    expect(prepared.preExecutionBlockers).toEqual([]);
    expect(prepared.seed.operationalSeedStatus).toBe('ready');
    expect(prepared.seed.data.ticketId).toBe('ticket-1');
    expect(prepared.seed.data.conversationId).toBe('conv-1');
    expect(prepared.seed.data.contactId).toBe('contact-1');
    expect(prepared.seed.seedEvidence.ticketId).toBe('ticket-1');
  });

  test('createStepSnapshotCollector usa coletor entity-scoped real (sem global snapshot)', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'entity_scoped', filterApplied: false },
      db: { ticket: { id: 'ticket-1' } },
    }));
    const collectOperationalSnapshot = jest.fn(async () => ({ metadata: { collector: 'global' } }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      collectOperationalSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const collector = isolatedService.createStepSnapshotCollector({
      path: '/tmp/non-existent-replay.json',
      payload: {
        scenario: { journeyId: 'support_ticket_flow' },
      },
      scenario: { journeyId: 'support_ticket_flow' },
    });

    await collector({
      phase: 'before',
      stepSpec: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      stepResult: { id: 'step_reply_ticket', actionType: 'type_and_send' },
    });

    expect(collectEntityScopedSnapshot).toHaveBeenCalledTimes(1);
    expect(collectEntityScopedSnapshot.mock.calls[0][0].stepId).toBe('step_reply_ticket');
    expect(collectOperationalSnapshot).not.toHaveBeenCalled();
  });

  test('createStepSnapshotCollector usa IDs atualizados do replay salvo em disco', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'entity_scoped', filterApplied: false },
      db: { ticket: { id: 'ticket-1' } },
    }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const replayPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-wave-replay-')), 'replay.json');
    fs.writeFileSync(replayPath, JSON.stringify({
      journeyId: 'support_ticket_flow',
      seed: {
        data: { conversationId: 'conv-live', ticketId: 'ticket-live' },
        seedEvidence: {
          provision: { conversationId: 'conv-live', ticketId: 'ticket-live' },
        },
      },
      payload: {
        seedEvidence: {
          provision: { conversationId: 'conv-live', ticketId: 'ticket-live' },
        },
      },
    }));

    const collector = isolatedService.createStepSnapshotCollector({
      path: replayPath,
      payload: {
        scenario: { journeyId: 'support_ticket_flow' },
        seedEvidence: { provision: { conversationId: null, ticketId: 'ticket-stale' } },
      },
      scenario: { journeyId: 'support_ticket_flow' },
      seed: {
        data: { conversationId: null, ticketId: 'ticket-stale' },
        seedEvidence: { provision: { conversationId: null, ticketId: 'ticket-stale' } },
      },
    });

    await collector({
      phase: 'before',
      stepSpec: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      stepResult: { id: 'step_reply_ticket', actionType: 'type_and_send' },
    });

    expect(collectEntityScopedSnapshot).toHaveBeenCalledTimes(1);
    expect(collectEntityScopedSnapshot.mock.calls[0][0].conversationId).toBe('conv-live');
    expect(collectEntityScopedSnapshot.mock.calls[0][0].ticketId).toBe('ticket-live');

    fs.rmSync(path.dirname(replayPath), { recursive: true, force: true });
  });

  test('createStepSnapshotCollector falha quando coletor não é entity-scoped', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'global', filterApplied: false },
      db: { ticket: { id: 'ticket-1' } },
    }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const collector = isolatedService.createStepSnapshotCollector({
      path: '/tmp/non-existent-replay.json',
      payload: { scenario: { journeyId: 'support_ticket_flow' } },
      scenario: { journeyId: 'support_ticket_flow' },
    });

    await expect(collector({
      phase: 'after',
      stepSpec: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      stepResult: { id: 'step_reply_ticket', actionType: 'type_and_send' },
    })).rejects.toThrow('invalid_step_snapshot_collector:step_reply_ticket');
  });

  test('createStepSnapshotCollector falha quando snapshot final veio de filtro posterior', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'entity_scoped', filterApplied: true },
      db: { ticket: { id: 'ticket-1' } },
    }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const collector = isolatedService.createStepSnapshotCollector({
      path: '/tmp/non-existent-replay.json',
      payload: { scenario: { journeyId: 'support_ticket_flow' } },
      scenario: { journeyId: 'support_ticket_flow' },
    });

    await expect(collector({
      phase: 'after',
      stepSpec: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      stepResult: { id: 'step_reply_ticket', actionType: 'type_and_send' },
    })).rejects.toThrow('invalid_step_snapshot_collector:step_reply_ticket');
  });

  test('createStepSnapshotCollector falha para reply_ticket com entidades não relacionadas', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'entity_scoped', filterApplied: false },
      db: {
        ticket: { id: 'ticket-1' },
        attendance: { count: 10 },
      },
    }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const collector = isolatedService.createStepSnapshotCollector({
      path: '/tmp/non-existent-replay.json',
      payload: { scenario: { journeyId: 'support_ticket_flow' } },
      scenario: { journeyId: 'support_ticket_flow' },
    });

    await expect(collector({
      phase: 'before',
      stepSpec: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      stepResult: { id: 'step_reply_ticket', actionType: 'type_and_send' },
    })).rejects.toThrow('entity_scope_unrelated_data:step_reply_ticket');
  });

  test('createStepSnapshotCollector falha para submit_checkin com estado global de support', async () => {
    jest.resetModules();
    const collectEntityScopedSnapshot = jest.fn(async () => ({
      metadata: { collector: 'entity_scoped', filterApplied: false },
      db: {
        attendance: { count: 1 },
        ticket: { id: 'ticket-should-not-be-here' },
      },
    }));

    jest.doMock('../qa/stateSnapshotService', () => ({
      collectEntityScopedSnapshot,
      normalizeJourneyId: jest.fn((value) => value),
    }));

    let isolatedService;
    jest.isolateModules(() => {
      isolatedService = require('../qaWavesExecutionService');
    });

    const collector = isolatedService.createStepSnapshotCollector({
      path: '/tmp/non-existent-replay.json',
      payload: { scenario: { journeyId: 'fitness_customer_checkin' } },
      scenario: { journeyId: 'fitness_customer_checkin' },
    });

    await expect(collector({
      phase: 'after',
      stepSpec: { id: 'step_submit_checkin', actionType: 'checkin_submit' },
      stepResult: { id: 'step_submit_checkin', actionType: 'checkin_submit' },
    })).rejects.toThrow('entity_scope_unrelated_data:step_submit_checkin');
  });
});
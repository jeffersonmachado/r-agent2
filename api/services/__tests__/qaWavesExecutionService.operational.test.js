'use strict';

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
});
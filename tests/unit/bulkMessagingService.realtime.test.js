'use strict';

/**
 * Testes do evento WebSocket `campaign.updated` emitido por bulkMessagingService.
 *
 * Garante:
 * - emissão nas transições de estado (criação, início, pausa, retomada,
 *   exclusão, conclusão), sempre direcionada ao tenant;
 * - progresso agregado com throttle (nunca 1 evento por destinatário).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('bulkMessagingService - evento campaign.updated', () => {
  let emitEvent;
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent }));
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ ok: true })),
    }));

    service = require('../../api/services/bulkMessagingService');
  });

  function createTestCampaign(overrides = {}) {
    const out = service.createCampaign({
      tenantId: 'tenant-ws',
      name: 'Campanha WS',
      message: 'Mensagem WS',
      phoneNumbers: ['+5511999999999'],
      createdBy: 'agent-1',
      ...overrides,
    });
    expect(out.success).toBe(true);
    return out.campaign;
  }

  function emittedActions() {
    return emitEvent.mock.calls
      .filter(([event]) => event === 'campaign.updated')
      .map(([, payload]) => payload.action);
  }

  test('createCampaign emite campaign.updated com payload mínimo direcionado ao tenant', () => {
    const campaign = createTestCampaign();

    expect(emitEvent).toHaveBeenCalledTimes(1);
    const [event, payload, options] = emitEvent.mock.calls[0];
    expect(event).toBe('campaign.updated');
    expect(payload).toEqual(expect.objectContaining({
      tenantId: 'tenant-ws',
      campaignId: campaign.id,
      status: 'draft',
      action: 'created',
      counters: expect.objectContaining({
        totalRecipients: 1,
        sentCount: 0,
        failedCount: 0,
        pendingCount: 1,
      }),
    }));
    expect(options).toEqual({ tenantId: 'tenant-ws' });
  });

  test('start/pause/resume/delete emitem nas transições de estado', async () => {
    const campaign = createTestCampaign();

    await service.startCampaign(campaign.id);
    service.pauseCampaign(campaign.id);
    service.resumeCampaign(campaign.id);
    service.pauseCampaign(campaign.id);
    service.deleteCampaign(campaign.id);

    const actions = emittedActions();
    expect(actions).toEqual(expect.arrayContaining(['created', 'started', 'paused', 'resumed', 'deleted']));

    // Todos os eventos direcionados ao tenant (nunca broadcast global)
    for (const [, payload, options] of emitEvent.mock.calls) {
      expect(payload.tenantId).toBe('tenant-ws');
      expect(options).toEqual({ tenantId: 'tenant-ws' });
    }
  });

  test('conclusão emite campaign.updated com status completed', async () => {
    const campaign = createTestCampaign({ rateLimit: 100 });

    await service.startCampaign(campaign.id);

    for (let i = 0; i < 100; i += 1) {
      if (service.getCampaign(campaign.id)?.status === 'completed') break;
      // eslint-disable-next-line no-await-in-loop
      await wait(30);
    }

    expect(service.getCampaign(campaign.id).status).toBe('completed');
    const completedCall = emitEvent.mock.calls.find(
      ([event, payload]) => event === 'campaign.updated' && payload.action === 'completed',
    );
    expect(completedCall).toBeDefined();
    expect(completedCall[1]).toEqual(expect.objectContaining({
      campaignId: campaign.id,
      status: 'completed',
      counters: expect.objectContaining({ sentCount: 1, pendingCount: 0 }),
    }));
  });

  test('progresso é agregado com throttle — nunca 1 evento por destinatário', async () => {
    const campaign = createTestCampaign({
      phoneNumbers: ['+5511999999999', '+5511888888888', '+5511777777777'],
      rateLimit: 100, // 600ms entre envios: 3 destinatários dentro da janela de 5s
    });

    await service.startCampaign(campaign.id);

    for (let i = 0; i < 100; i += 1) {
      if (service.getCampaign(campaign.id)?.status === 'completed') break;
      // eslint-disable-next-line no-await-in-loop
      await wait(30);
    }

    expect(service.getCampaign(campaign.id).status).toBe('completed');

    const progressCalls = emitEvent.mock.calls.filter(
      ([event, payload]) => event === 'campaign.updated' && payload.action === 'progress',
    );
    // 3 destinatários processados, mas no máximo 1 evento de progresso (janela de 5s)
    expect(progressCalls.length).toBeLessThanOrEqual(1);
    expect(progressCalls.length).toBeLessThan(3);
  });

  test('campanha sem tenantId não emite evento', () => {
    const out = service.createCampaign({
      tenantId: '',
      name: 'Campanha sem tenant',
      message: 'Mensagem',
      phoneNumbers: ['+5511999999999'],
      createdBy: 'agent-1',
    });

    expect(out.success).toBe(false);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

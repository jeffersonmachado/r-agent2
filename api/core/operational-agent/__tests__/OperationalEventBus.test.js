'use strict';

jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEvent: jest.fn(async (input) => ({
    ok: true,
    event: {
      id: 'evt-1',
      type: input?.type,
      tenantId: input?.tenantId,
      contactId: input?.contactId || null,
    },
  })),
}));

const { writeOperationalEvent } = require('../../crm/OperationalEventWriter');
const { OperationalEventBus } = require('../OperationalEventBus');

describe('OperationalEventBus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('orquestra evento e pipeline contextual por contato', async () => {
    const operationalAgentService = {
      generateContactSignals: jest.fn(async () => ({ ok: true, opened: [] })),
      generateContactRecommendations: jest.fn(async () => ({ ok: true, generated: [] })),
      generateTenantSignals: jest.fn(async () => ({ ok: true, opened: [] })),
      generateTenantRecommendations: jest.fn(async () => ({ ok: true, generated: [] })),
    };

    const bus = new OperationalEventBus({ operationalAgentService });
    const out = await bus.publishEvent({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'whatsapp_message_received',
      payload: { text: 'oi' },
      triggerPipeline: true,
    });

    expect(out.ok).toBe(true);
    expect(writeOperationalEvent).toHaveBeenCalled();
    expect(operationalAgentService.generateContactSignals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
    });
    expect(operationalAgentService.generateContactRecommendations).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      includeSignalGeneration: false,
    });
    expect(operationalAgentService.generateTenantSignals).not.toHaveBeenCalled();
  });

  test('permite publicar evento sem disparar pipeline', async () => {
    const operationalAgentService = {
      generateContactSignals: jest.fn(),
      generateContactRecommendations: jest.fn(),
      generateTenantSignals: jest.fn(),
      generateTenantRecommendations: jest.fn(),
    };

    const bus = new OperationalEventBus({ operationalAgentService });
    const out = await bus.publishEvent({
      tenantId: 'tenant-1',
      type: 'operational_notification',
      triggerPipeline: false,
    });

    expect(out.ok).toBe(true);
    expect(out.pipeline?.triggered).toBe(false);
    expect(operationalAgentService.generateTenantSignals).not.toHaveBeenCalled();
  });

  test('retorna erro quando tenant não é informado', async () => {
    const bus = new OperationalEventBus({ operationalAgentService: {} });
    const out = await bus.publishEvent({ type: 'x' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('tenant_required');
  });
});

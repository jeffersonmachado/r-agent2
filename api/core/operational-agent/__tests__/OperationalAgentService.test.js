'use strict';

const mockWriteOperationalEventBestEffort = jest.fn();

jest.mock('../../operational-state', () => ({
  recommendationStateStoreV2: {
    upsertRecommendations: jest.fn(),
    listRecommendations: jest.fn(),
  },
}));

jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEventBestEffort: (...args) => mockWriteOperationalEventBestEffort(...args),
}));

const { recommendationStateStoreV2 } = require('../../operational-state');
const { OperationalAgentService } = require('../OperationalAgentService');

describe('OperationalAgentService', () => {
  let recommendationStoreByTenant;

  beforeEach(() => {
    jest.clearAllMocks();
    recommendationStoreByTenant = new Map();

    recommendationStateStoreV2.listRecommendations.mockImplementation(async ({ tenantId, contactId = null, limit = 200 }) => {
      const tenantKey = String(tenantId);
      const list = recommendationStoreByTenant.get(tenantKey) || [];
      const filtered = contactId
        ? list.filter((item) => String(item.contact_id || '') === String(contactId))
        : list;
      return {
        ok: true,
        items: filtered.slice(0, limit),
        total: filtered.length,
        limit,
      };
    });

    recommendationStateStoreV2.upsertRecommendations.mockImplementation(async ({ tenantId, items }) => {
      const tenantKey = String(tenantId);
      const current = recommendationStoreByTenant.get(tenantKey) || [];
      const byId = new Map(current.map((item) => [String(item.id), item]));
      for (const item of Array.isArray(items) ? items : []) {
        byId.set(String(item.id), item);
      }
      recommendationStoreByTenant.set(tenantKey, Array.from(byId.values()));
      return { ok: true, upserted: Array.isArray(items) ? items.length : 0 };
    });
  });

  test('gera sinais e publica evento de abertura para cada novo sinal', async () => {
    const detectionService = {
      detectTenantSignals: jest.fn(async () => ({
        ok: true,
        signals: [{
          id: 'sig-1',
          tenantId: 'tenant-1',
          contactId: 'contact-1',
          type: 'support_backlog_risk',
          severity: 'high',
          confidence: 0.8,
          sourceModule: 'queue_service',
          context: { waitingTickets: 20 },
        }],
      })),
    };

    const signalRegistry = {
      upsertDetectedSignals: jest.fn(async () => ({
        ok: true,
        opened: [{
          id: 'sig-1',
          tenant_id: 'tenant-1',
          contact_id: 'contact-1',
          type: 'support_backlog_risk',
          severity: 'high',
          confidence: 0.8,
        }],
        merged: [],
        items: [],
      })),
      listSignals: jest.fn(),
      updateSignalStatus: jest.fn(),
    };

    const service = new OperationalAgentService({ detectionService, signalRegistry });
    const out = await service.generateTenantSignals({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(signalRegistry.upsertDetectedSignals).toHaveBeenCalled();
    expect(mockWriteOperationalEventBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      type: 'operational_signal_opened',
      referenceType: 'operational_signal',
      referenceId: 'sig-1',
    }), 'OperationalAgentService.generateTenantSignals');
  });

  test('gera recomendações a partir de sinais e permite atualizar status', async () => {
    const signalRegistry = {
      upsertDetectedSignals: jest.fn(),
      updateSignalStatus: jest.fn(),
      listSignals: jest.fn(async () => ({
        ok: true,
        items: [{
          id: 'sig-1',
          tenant_id: 'tenant-1',
          contact_id: 'contact-1',
          type: 'support_backlog_risk',
          severity: 'high',
          confidence: 0.8,
          source_module: 'queue_service',
          context_json: { waitingTickets: 20 },
        }],
      })),
    };

    const detectionService = {
      detectTenantSignals: jest.fn(async () => ({ ok: true, signals: [] })),
    };

    const service = new OperationalAgentService({ detectionService, signalRegistry });
    const generated = await service.generateTenantRecommendations({
      tenantId: 'tenant-1',
      includeSignalGeneration: false,
    });

    expect(generated.ok).toBe(true);
    expect(generated.generated).toHaveLength(1);
    expect(generated.generated[0].source_signal_id).toBe('sig-1');
    expect(generated.generated[0].type).toBe('assign_ticket');

    const recommendationId = generated.generated[0].id;
    const statusOut = await service.updateRecommendationStatus({
      tenantId: 'tenant-1',
      recommendationId,
      status: 'accepted',
      actorId: 'admin-1',
    });

    expect(statusOut.ok).toBe(true);
    expect(statusOut.item.status).toBe('accepted');
    expect(mockWriteOperationalEventBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      type: 'operational_recommendation_accepted',
      referenceType: 'operational_recommendation',
      referenceId: recommendationId,
      actorId: 'admin-1',
    }), 'RecommendationEngine.updateRecommendationStatus');
  });
});

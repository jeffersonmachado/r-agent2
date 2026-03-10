'use strict';

const mockWrite = jest.fn();
jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEventBestEffort: (...args) => mockWrite(...args),
}));

const { RecommendationEngine } = require('../RecommendationEngine');

function createInMemoryRecommendationStore() {
  const byTenant = new Map();

  function getItems(tenantId) {
    const key = String(tenantId || '');
    if (!byTenant.has(key)) byTenant.set(key, []);
    return byTenant.get(key);
  }

  return {
    async upsertRecommendations({ tenantId, recommendations = [] }) {
      const list = getItems(tenantId);
      const generated = [];

      for (const recommendation of recommendations) {
        const exists = list.find((item) => (
          String(item.source_signal_id || '') === String(recommendation.source_signal_id || '')
          && String(item.type || '') === String(recommendation.type || '')
        ));
        if (exists) continue;
        list.push({ ...recommendation });
        generated.push({ ...recommendation });
      }

      return { ok: true, generated, items: [...list], total: list.length };
    },

    async listRecommendations({ tenantId, contactId = null, limit = 200 }) {
      const list = getItems(tenantId)
        .filter((item) => !contactId || String(item.contact_id || '') === String(contactId))
        .slice(0, limit);
      return { ok: true, items: list, total: list.length, limit };
    },

    async updateRecommendationStatus({ tenantId, recommendationId, status }) {
      const list = getItems(tenantId);
      const idx = list.findIndex((item) => String(item.id) === String(recommendationId));
      if (idx < 0) return { ok: false, error: 'recommendation_not_found' };
      list[idx] = { ...list[idx], status: String(status || 'open') };
      return { ok: true, item: list[idx] };
    },
  };
}

describe('RecommendationEngine (operational)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('gera recomendações de sinais sem depender de OperationalAgentService', async () => {
    const store = createInMemoryRecommendationStore();
    const engine = new RecommendationEngine({
      recommendationStore: store,
      signalService: {
        generateTenantSignals: jest.fn(async () => ({ ok: true })),
      },
      signalRepository: {
        listTenantActiveSignals: jest.fn(async () => ({
          ok: true,
          items: [{
            id: 'sig-1',
            tenant_id: 'tenant-1',
            contact_id: 'contact-1',
            type: 'ticket_stalled',
            severity: 'high',
            confidence: 0.8,
            source_module: 'support',
            context_json: { waitingMinutes: 20 },
          }],
        })),
      },
    });

    const out = await engine.generateForTenant({ tenantId: 'tenant-1', includeSignalGeneration: true });

    expect(out.ok).toBe(true);
    expect(out.generated).toHaveLength(1);
    expect(out.generated[0].source_signal_id).toBe('sig-1');
    expect(out.generated[0].type).toBe('assign_ticket');
    expect(mockWrite).toHaveBeenCalled();
  });

  test('lista e atualiza status de recomendação', async () => {
    const store = createInMemoryRecommendationStore();
    const engine = new RecommendationEngine({ recommendationStore: store });

    const generated = await engine.generateFromSignals({
      tenantId: 'tenant-2',
      signals: [{
        id: 'sig-2',
        tenant_id: 'tenant-2',
        contact_id: 'contact-2',
        type: 'schedule_conflict',
        severity: 'medium',
        confidence: 0.7,
      }],
    });

    expect(generated.ok).toBe(true);
    const recommendationId = generated.generated[0].id;

    const listOut = await engine.listContactRecommendations({ tenantId: 'tenant-2', contactId: 'contact-2', limit: 10 });
    expect(listOut.ok).toBe(true);
    expect(listOut.total).toBe(1);

    const updateOut = await engine.updateRecommendationStatus({
      tenantId: 'tenant-2',
      recommendationId,
      status: 'accepted',
      actorId: 'agent-1',
    });

    expect(updateOut.ok).toBe(true);
    expect(updateOut.item.status).toBe('accepted');
  });
});

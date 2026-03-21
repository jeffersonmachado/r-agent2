'use strict';

const { createEvidenceService } = require('../../api/services/evidenceService');

function makeEvidenceModel(initialRows = []) {
  const rows = [...initialRows];
  return {
    rows,
    findAll: jest.fn(async ({ where }) => rows.filter((row) => {
      if (row.tenant_key !== where.tenant_key) return false;
      const orConditions = where[require('sequelize').Op.or] || [];
      if (!orConditions.length) return true;
      return orConditions.some((condition) => (
        row.entity_type === condition.entity_type && row.entity_id === condition.entity_id
      ));
    })),
    findOne: jest.fn(async ({ where }) => rows.find((row) => row.tenant_key === where.tenant_key && row.idempotency_key === where.idempotency_key) || null),
    create: jest.fn(async (payload) => {
      if (rows.some((row) => row.tenant_key === payload.tenant_key && row.idempotency_key === payload.idempotency_key)) {
        const err = new Error('unique violation');
        err.name = 'SequelizeUniqueConstraintError';
        throw err;
      }
      rows.push(payload);
      return { toJSON: () => payload };
    }),
  };
}

function getter(api) {
  return () => api;
}

describe('evidence support flow integration', () => {
  test('usa evidência persistida boa quando ela já existe', async () => {
    const model = makeEvidenceModel([{
      id: 'evd-persisted',
      tenant_key: 'tenant1',
      entity_type: 'customer',
      entity_id: 'cust-1',
      related_entities: [],
      source_type: 'event_ledger',
      source_id: 'evt-1',
      source_ref: { ticketId: 't1' },
      category: 'billing',
      type: 'price_notice',
      theme: 'price_adjustment',
      summary: 'aviso formal',
      excerpt: 'Informamos anteriormente o reajuste previsto em contrato.',
      normalized_text: 'informamos anteriormente o reajuste previsto em contrato',
      occurred_at: '2026-02-10T00:00:00.000Z',
      confidence: 0.92,
      strength: 'formal',
      attachments: [],
      actor_type: 'system',
      idempotency_key: 'persisted-1',
    }]);
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-1', confidence: 0.96, relatedEntities: [] },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({ ok: true, items: [] })),
      },
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
    });

    const result = await service.findBestEvidenceForContextWithFallback({
      tenantId: 'tenant1',
      context: { ticketId: 't1' },
      query: 'cliente questiona aumento',
      filters: { theme: ['price_adjustment'] },
    });

    expect(result.best.id).toBe('evd-persisted');
    expect(result.best.evidence_origin.kind).toBe('persisted');
    expect(result.sourceInfo.strategyUsed).toBe('persisted');
    expect(result.best.origin_locator).toEqual(expect.objectContaining({
      sourceType: 'event_ledger',
      sourceId: 'evt-1',
      ticketId: 't1',
    }));
  });

  test('quando não há persistido, extrai fallback em tempo real e pode persistir', async () => {
    const model = makeEvidenceModel();
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: {
            entityType: 'customer',
            entityId: 'cust-2',
            confidence: 0.96,
            relatedEntities: [{ type: 'ticket', id: 't2' }],
          },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({
          ok: true,
          items: [
            {
              id: 'message:m2',
              timestamp: '2026-02-11T00:00:00.000Z',
              source: 'channel_message',
              sourceType: 'channel_message',
              direction: 'outbound',
              title: 'whatsapp outbound',
              text: 'Informamos o reajuste previsto em política vigente e reenviamos o contrato.',
              relatedEntities: [{ type: 'ticket', id: 't2' }],
              ticketId: 't2',
              conversationId: 'c2',
            },
          ],
        })),
      },
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
    });

    const result = await service.findBestEvidenceForContextWithFallback({
      tenantId: 'tenant1',
      context: { ticketId: 't2' },
      query: 'cliente disse que nao foi informado',
      options: { persistFallback: true, includeTimeline: true },
    });

    expect(result.best).toBeTruthy();
    expect(['transient', 'fallback_persisted']).toContain(result.best.evidence_origin.kind);
    expect(result.sourceInfo.fallbackTried).toBe(true);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(model.create).toHaveBeenCalled();
    expect(result.best.origin_locator).toEqual(expect.objectContaining({
      sourceType: 'channel_message',
      conversationId: 'c2',
    }));
  });

  test('não força best ruim quando o fallback não encontra evidência boa', async () => {
    const model = makeEvidenceModel();
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-3', confidence: 0.96, relatedEntities: [] },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({
          ok: true,
          items: [
            {
              id: 'message:m3',
              timestamp: '2026-02-12T00:00:00.000Z',
              source: 'channel_message',
              sourceType: 'channel_message',
              direction: 'inbound',
              title: 'whatsapp inbound',
              text: 'ok obrigado',
              relatedEntities: [],
            },
          ],
        })),
      },
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
    });

    const result = await service.findBestEvidenceForContextWithFallback({
      tenantId: 'tenant1',
      context: { ticketId: 't3' },
      query: 'cliente questiona aumento',
      options: { minScore: 95, persistFallback: false },
    });

    expect(result.best).toBeNull();
    expect(result.reasoning.reason).toBeTruthy();
  });

  test('protege multi-tenant no fluxo híbrido', async () => {
    const model = makeEvidenceModel([{
      id: 'evd-other-tenant',
      tenant_key: 'tenant2',
      entity_type: 'customer',
      entity_id: 'cust-1',
      related_entities: [],
      source_type: 'event_ledger',
      source_id: 'evt-tenant2',
      source_ref: {},
      category: 'billing',
      type: 'price_notice',
      theme: 'price_adjustment',
      summary: 'tenant 2',
      excerpt: 'evidência de outro tenant',
      normalized_text: 'evidência de outro tenant',
      occurred_at: '2026-02-10T00:00:00.000Z',
      confidence: 0.95,
      strength: 'formal',
      attachments: [],
      actor_type: 'system',
      idempotency_key: 'tenant2-only',
    }]);
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-1', confidence: 0.96, relatedEntities: [] },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({ ok: true, items: [] })),
      },
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
    });

    const result = await service.findBestEvidenceForContextWithFallback({
      tenantId: 'tenant1',
      context: { ticketId: 't1' },
      query: 'cliente questiona aumento',
    });

    expect(result.best).toBeNull();
  });

  test('aplica limites previsíveis no fallback e sinaliza truncamento', async () => {
    const model = makeEvidenceModel();
    const timelineItems = Array.from({ length: 12 }, (_, index) => ({
      id: `message:m${index}`,
      timestamp: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      source: 'channel_message',
      sourceType: 'channel_message',
      direction: 'outbound',
      title: 'whatsapp outbound',
      text: `Informamos o reajuste previsto em contrato ${index}.`,
      relatedEntities: [],
      conversationId: 'c-limit',
    }));
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-limit', confidence: 0.96, relatedEntities: [] },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({ ok: true, items: timelineItems })),
      },
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
    });

    const result = await service.findBestEvidenceForContextWithFallback({
      tenantId: 'tenant1',
      context: { ticketId: 't-limit' },
      query: 'cliente questiona aumento',
      options: { maxTimelineItems: 5, maxTransientCandidates: 3, persistFallback: false },
    });

    expect(result.timeline).toHaveLength(10);
    expect(result.reasoning.truncated.timeline).toBe(true);
  });
});

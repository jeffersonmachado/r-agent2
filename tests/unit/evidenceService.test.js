'use strict';

const { createEvidenceService } = require('../../api/services/evidenceService');

describe('evidenceService', () => {
  function makeEvidenceModel() {
    const rows = [];
    return {
      rows,
      findAll: jest.fn(async ({ where }) => rows.filter((row) => {
        if (row.tenant_key !== where.tenant_key) return false;
        if (where.category?.$in || where.type?.$in || where.theme?.$in) return true;
        if (Array.isArray(where.$or)) return true;
        return true;
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

  test('score prioriza evidência mais forte e formal', async () => {
    const model = makeEvidenceModel();
    const service = createEvidenceService({
      Evidence: getter(model),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-1', confidence: 0.96, relatedEntities: [] },
        })),
      },
    });

    model.rows.push(
      {
        id: 'evd-1',
        tenant_key: 'tenant1',
        entity_type: 'customer',
        entity_id: 'cust-1',
        related_entities: [],
        source_type: 'channel_message',
        source_id: 'm1',
        category: 'billing',
        type: 'price_notice',
        theme: 'price_adjustment',
        summary: 'aviso simples',
        excerpt: 'mensagem simples',
        normalized_text: 'mensagem simples sobre reajuste',
        occurred_at: '2026-01-10T00:00:00.000Z',
        confidence: 0.7,
        strength: 'moderate',
        attachments: [],
        actor_type: 'agent',
      },
      {
        id: 'evd-2',
        tenant_key: 'tenant1',
        entity_type: 'customer',
        entity_id: 'cust-1',
        related_entities: [],
        source_type: 'event_ledger',
        source_id: 'evt-1',
        category: 'billing',
        type: 'price_notice',
        theme: 'price_adjustment',
        summary: 'aviso formal',
        excerpt: 'informamos anteriormente o reajuste previsto em contrato',
        normalized_text: 'informamos anteriormente o reajuste previsto em contrato',
        occurred_at: '2026-01-11T00:00:00.000Z',
        confidence: 0.92,
        strength: 'formal',
        attachments: [{ url: 'https://example.test/doc.pdf' }],
        actor_type: 'system',
      },
    );

    const result = await service.searchEvidence({
      tenantId: 'tenant1',
      context: { entityType: 'customer', entityId: 'cust-1' },
      filters: { theme: ['price_adjustment'], type: ['price_notice'], category: ['billing'] },
      query: 'cliente questiona aumento',
      options: { limit: 5, includeWeak: true },
    });

    expect(result.ok).toBe(true);
    expect(result.best.id).toBe('evd-2');
    expect(result.reasoning.score).toBeGreaterThan(0);
  });

  test('backfill é idempotente para a mesma fonte', async () => {
    const model = makeEvidenceModel();
    const service = createEvidenceService({
      Evidence: getter(model),
      ChannelConversation: getter({ findAll: jest.fn(async () => []) }),
      EventLedger: getter({ findAll: jest.fn(async () => []) }),
      identityService: {
        resolveIdentity: jest.fn(async () => ({
          ok: true,
          identity: { entityType: 'customer', entityId: 'cust-1', confidence: 0.9, relatedEntities: [] },
        })),
      },
      timelineService: {
        getTimeline: jest.fn(async () => ({
          ok: true,
          items: [
            {
              id: 'message:m1',
              timestamp: '2026-02-10T12:00:00.000Z',
              source: 'channel_message',
              sourceType: 'channel_message',
              title: 'whatsapp outbound',
              text: 'Informamos o reajuste previsto em contrato.',
              relatedEntities: [],
            },
          ],
        })),
      },
    });

    const first = await service.backfillEvidenceForEntity({
      tenantId: 'tenant1',
      entityType: 'customer',
      entityId: 'cust-1',
    });
    const second = await service.backfillEvidenceForEntity({
      tenantId: 'tenant1',
      entityType: 'customer',
      entityId: 'cust-1',
    });

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.existing).toBeGreaterThan(0);
  });
});

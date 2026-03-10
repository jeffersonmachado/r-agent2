'use strict';

const { OperationalCanonicalPipelineService } = require('../OperationalCanonicalPipelineService');

describe('OperationalCanonicalPipelineService', () => {
  test('executa o ciclo canônico principal', async () => {
    const service = new OperationalCanonicalPipelineService({
      eventsService: {
        ingestEvent: jest.fn().mockResolvedValue({
          ok: true,
          tenantId: 'tenant-1',
          contactId: 'contact-1',
          signals: [{ id: 'sig-1' }],
        }),
      },
      signalsService: {},
      recommendationsService: {
        generateForContact: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'rec-1' }],
        }),
        generateForTenant: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'rec-1' }],
        }),
      },
      decisionEngine: {
        listRecommendationDecisions: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ recommendationId: 'rec-1', signalId: 'sig-1', contactId: 'contact-1' }],
        }),
      },
      actionsService: {
        executeFromRecommendation: jest.fn().mockResolvedValue({
          ok: true,
          action: { id: 'act-1' },
        }),
      },
      outcomesService: {
        listOutcomes: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'out-1' }],
        }),
      },
      memoryService: {
        searchRelevantMemories: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'mem-1' }],
        }),
      },
    });

    const out = await service.runEventDrivenCycle({
      event: { tenantId: 'tenant-1', contactId: 'contact-1', payload: { message: 'oi' } },
      execute: true,
      actionId: 'notify_customer',
    });

    expect(out.ok).toBe(true);
    expect(out.signals).toEqual([{ id: 'sig-1' }]);
    expect(out.recommendations).toEqual([{ id: 'rec-1' }]);
    expect(out.decisions).toHaveLength(1);
    expect(out.actionExecution.ok).toBe(true);
    expect(out.outcomes).toEqual([{ id: 'out-1' }]);
    expect(out.memory).toEqual([{ id: 'mem-1' }]);
  });
});

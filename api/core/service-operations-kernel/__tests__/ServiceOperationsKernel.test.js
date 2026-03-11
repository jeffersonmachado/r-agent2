'use strict';

const { ServiceOperationsKernel } = require('..');

describe('ServiceOperationsKernel', () => {
  test('executa action por sourceType e registra decisão no loop canônico', async () => {
    const kernel = new ServiceOperationsKernel({
      actionsService: {
        executeFromSignal: jest.fn().mockResolvedValue({ ok: true, action: { id: 'act-sig' } }),
        executeFromRecommendation: jest.fn().mockResolvedValue({ ok: true, action: { id: 'act-rec' } }),
      },
      memoryService: {
        recordDecision: jest.fn().mockResolvedValue({ ok: true }),
      },
    });

    const out = await kernel.executeAction({
      tenantId: 'tenant-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      actionId: 'notify_customer',
    });

    expect(out.ok).toBe(true);
    expect(kernel.memoryService.recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      actionId: 'notify_customer',
      actionMode: 'quick_action',
    }));
    expect(kernel.actionsService.executeFromRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 'rec-1',
      actionId: 'notify_customer',
    }));
  });

  test('executa o ciclo event -> decision -> action -> outcome -> memory', async () => {
    const kernel = new ServiceOperationsKernel({
      eventsService: {
        ingestEvent: jest.fn().mockResolvedValue({
          ok: true,
          tenantId: 'tenant-1',
          contactId: 'contact-1',
          signals: [{ id: 'sig-1' }],
        }),
      },
      recommendationsService: {
        generateForContact: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'rec-1' }] }),
        generateForTenant: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'rec-1' }] }),
      },
      decisionEngine: {
        listRecommendationDecisions: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ recommendationId: 'rec-1', signalId: 'sig-1', contactId: 'contact-1' }],
        }),
      },
      actionsService: {
        executeFromRecommendation: jest.fn().mockResolvedValue({ ok: true, action: { id: 'act-1' } }),
      },
      outcomesService: {
        listOutcomes: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'out-1' }] }),
      },
      memoryService: {
        searchRelevantMemories: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'mem-1' }] }),
        recordDecision: jest.fn().mockResolvedValue({ ok: true }),
      },
    });

    const out = await kernel.runEventDrivenCycle({
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
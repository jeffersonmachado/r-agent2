'use strict';

const mockActionCreate = jest.fn();
const mockRecordOutcome = jest.fn();

jest.mock('../../../db/models', () => ({
  OperationalAction: () => ({
    create: (...args) => mockActionCreate(...args),
  }),
}));

jest.mock('../../operational-outcomes', () => ({
  operationalOutcomeEngine: {
    recordOutcome: (...args) => mockRecordOutcome(...args),
    listOutcomes: jest.fn(async () => ({ ok: true, items: [], total: 0, limit: 120 })),
  },
}));

const { OutcomeTrackingService } = require('../OutcomeTrackingService');

describe('OutcomeTrackingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionCreate.mockResolvedValue({
      id: 'opact-1',
      toJSON() {
        return { id: 'opact-1', status: 'executed' };
      },
    });
    mockRecordOutcome.mockResolvedValue({
      ok: true,
      item: { id: 'opout-1', status: 'success' },
    });
  });

  test('registra action e outcome de execução com sucesso', async () => {
    const service = new OutcomeTrackingService();
    const out = await service.recordActionExecution({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'schedule_callback',
      actorType: 'user',
      actorId: 'u-1',
      input: { scheduledFor: '2026-03-10T10:00:00.000Z' },
      success: true,
      result: { kind: 'scheduled' },
    });

    expect(out.ok).toBe(true);
    expect(mockActionCreate).toHaveBeenCalled();
    expect(mockRecordOutcome).toHaveBeenCalled();
    expect(mockActionCreate).toHaveBeenCalledWith(expect.objectContaining({
      input_json: expect.objectContaining({
        trace: expect.objectContaining({
          sourceType: 'signal',
          sourceId: 'sig-1',
          signalId: 'sig-1',
        }),
      }),
    }));
    expect(mockRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      signalId: 'sig-1',
      recommendationId: null,
      actionId: 'opact-1',
      actionType: 'schedule_callback',
      outcomeScore: 0.8,
      resultContext: expect.objectContaining({
        trace: expect.objectContaining({
          signalId: 'sig-1',
          recommendationId: null,
          correlationId: 'sig-1',
        }),
      }),
    }));
  });

  test('valida campos obrigatórios', async () => {
    const service = new OutcomeTrackingService();
    const out = await service.recordActionExecution({
      tenantId: '',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'schedule_callback',
    });

    expect(out.ok).toBe(false);
    expect(out.error).toBe('tenant_required');
  });
});

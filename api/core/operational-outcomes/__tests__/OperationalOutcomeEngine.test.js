'use strict';

const mockCreate = jest.fn();
const mockFindAll = jest.fn();

jest.mock('../../../db/models', () => ({
  OperationalOutcome: () => ({
    create: (...args) => mockCreate(...args),
    findAll: (...args) => mockFindAll(...args),
  }),
}));

const { OutcomeClassifier } = require('../OutcomeClassifier');
const { OutcomeAttributionService } = require('../OutcomeAttributionService');
const { OperationalOutcomeEngine } = require('../OperationalOutcomeEngine');

describe('OperationalOutcomeEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      id: 'opout-1',
      toJSON() {
        return {
          id: 'opout-1',
          tenant_key: 'tenant-1',
          signal_id: 'sig-1',
          recommendation_id: null,
          outcome_type: 'manual_resolution',
          status: 'success',
        };
      },
    });
    mockFindAll.mockResolvedValue([]);
  });

  test('recordOutcome persiste campos canônicos e legados', async () => {
    const engine = new OperationalOutcomeEngine();
    const out = await engine.recordOutcome({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      signalId: 'sig-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionType: 'schedule_callback',
      outcomeType: 'manual_resolution',
      outcomeScore: 0.9,
      status: 'success',
      resultContext: { reason: 'resolved_by_agent' },
    });

    expect(out.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenant_key: 'tenant-1',
      contact_id: 'contact-1',
      signal_id: 'sig-1',
      source_type: 'signal',
      source_id: 'sig-1',
      action_type: 'schedule_callback',
      action_id: 'schedule_callback',
      outcome_type: 'manual_resolution',
      outcome_score: 0.9,
      status: 'success',
      result_context_json: expect.objectContaining({ reason: 'resolved_by_agent' }),
      details_json: expect.objectContaining({ reason: 'resolved_by_agent' }),
    }));
  });

  test('recordFromEvent classifica e atribui outcome', async () => {
    const engine = new OperationalOutcomeEngine({
      outcomeClassifier: new OutcomeClassifier(),
      outcomeAttributionService: new OutcomeAttributionService(),
    });

    const out = await engine.recordFromEvent({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      type: 'operational_playbook_completed',
      referenceType: 'playbook_run',
      referenceId: 'run-1',
      payload: {
        signalId: 'sig-1',
        recommendationId: 'rec-1',
      },
    });

    expect(out.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenant_key: 'tenant-1',
      contact_id: 'contact-1',
      signal_id: 'sig-1',
      recommendation_id: 'rec-1',
      playbook_execution_id: 'run-1',
      source_type: 'playbook',
      source_id: 'run-1',
      outcome_type: 'playbook_completed',
    }));
  });

  test('listOutcomes monta filtro por tenant/source/status', async () => {
    mockFindAll.mockResolvedValueOnce([{ toJSON: () => ({ id: 'out-1' }) }]);
    const engine = new OperationalOutcomeEngine();
    const out = await engine.listOutcomes({
      tenantId: 'tenant-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      status: 'success',
      limit: 10,
    });

    expect(out.ok).toBe(true);
    expect(out.total).toBe(1);
    expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenant_key: 'tenant-1',
        source_type: 'signal',
        source_id: 'sig-1',
        status: 'success',
      }),
      limit: 10,
    }));
  });

  test('listOutcomes aceita filtro por período', async () => {
    const engine = new OperationalOutcomeEngine();
    await engine.listOutcomes({
      tenantId: 'tenant-1',
      from: '2026-03-10',
      to: '2026-03-11',
      limit: 10,
    });

    expect(mockFindAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenant_key: 'tenant-1',
        produced_at: expect.any(Object),
      }),
      limit: 10,
    }));
  });

  test('buildOccSignalOutcomeMap retorna resumo por sinal com tempo de resolução', async () => {
    mockFindAll.mockResolvedValueOnce([
      {
        toJSON: () => ({
          id: 'out-1',
          signal_id: 'sig-1',
          status: 'success',
          outcome_score: 0.95,
          produced_at: '2026-03-10T10:05:00.000Z',
        }),
      },
    ]);

    const engine = new OperationalOutcomeEngine();
    const map = await engine.buildOccSignalOutcomeMap({
      tenantId: 'tenant-1',
      signalIds: ['sig-1', 'sig-2'],
      signalDetectedAtById: {
        'sig-1': '2026-03-10T10:00:00.000Z',
      },
    });

    expect(map['sig-1']).toMatchObject({
      hasSuccessfulOutcome: true,
      timeToResolutionMs: 5 * 60 * 1000,
    });
    expect(map['sig-2']).toMatchObject({
      lastOutcome: null,
      hasSuccessfulOutcome: false,
      timeToResolutionMs: null,
    });
  });
});

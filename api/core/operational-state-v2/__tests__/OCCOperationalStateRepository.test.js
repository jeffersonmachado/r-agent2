'use strict';

const { Op } = require('sequelize');
const {
  OCCOperationalStateRepository,
  PLAYBOOK_ACTIVE_STATUSES,
} = require('../OCCOperationalStateRepository');

describe('OCCOperationalStateRepository', () => {
  let signalModel;
  let recommendationModel;
  let playbookExecutionModel;
  let repository;

  beforeEach(() => {
    signalModel = {
      findAndCountAll: jest.fn(),
      count: jest.fn(),
      findAll: jest.fn(),
    };
    recommendationModel = {
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    };
    playbookExecutionModel = {
      findAndCountAll: jest.fn(),
      count: jest.fn(),
    };

    repository = new OCCOperationalStateRepository({
      signalModel,
      recommendationModel,
      playbookExecutionModel,
    });
  });

  test('getSignals aplica filtros e ordenação operacional por severidade/detected_at', async () => {
    signalModel.findAndCountAll.mockResolvedValueOnce({
      count: 2,
      rows: [
        {
          toJSON: () => ({
            id: 'sig-high',
            tenant_key: 'tenant-1',
            signal_type: 'support_backlog_risk',
            status: 'open',
            severity: 'high',
            confidence: 0.7,
            source_module: 'support',
            contact_id: 'contact-1',
            detected_at: '2026-03-10T10:00:00.000Z',
          }),
        },
        {
          toJSON: () => ({
            id: 'sig-critical',
            tenant_key: 'tenant-1',
            signal_type: 'support_backlog_risk',
            status: 'open',
            severity: 'critical',
            confidence: 0.8,
            source_module: 'support',
            contact_id: 'contact-2',
            detected_at: '2026-03-10T08:00:00.000Z',
          }),
        },
      ],
    });

    const out = await repository.getSignals({
      tenantId: 'tenant-1',
      status: 'open',
      severity: 'critical,high',
      type: 'support_backlog_risk',
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-31T23:59:59.999Z',
      limit: 50,
    });

    expect(out.ok).toBe(true);
    expect(out.total).toBe(2);
    expect(out.items[0]).toHaveProperty('id', 'sig-critical');
    expect(out.items[1]).toHaveProperty('id', 'sig-high');

    const call = signalModel.findAndCountAll.mock.calls[0][0];
    expect(call.limit).toBe(50);
    expect(call.order).toEqual([['detected_at', 'DESC']]);
    expect(call.where.tenant_key).toBe('tenant-1');
    expect(call.where.signal_type).toBe('support_backlog_risk');
    expect(call.where.status[Op.in]).toEqual(['open']);
    expect(call.where.severity[Op.in]).toEqual(['critical', 'high']);
    expect(call.where.detected_at[Op.gte]).toBe('2026-03-01T00:00:00.000Z');
    expect(call.where.detected_at[Op.lte]).toBe('2026-03-31T23:59:59.999Z');
  });

  test('getRecommendations aplica filtros por status/prioridade/tipo e mapeia signal_id', async () => {
    recommendationModel.findAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [
        {
          toJSON: () => ({
            id: 'rec-1',
            tenant_key: 'tenant-1',
            recommendation_type: 'schedule_contact',
            status: 'open',
            priority: 90,
            confidence: 0.8,
            impact_level: 'high',
            contact_id: 'contact-1',
            source_signal_id: 'sig-1',
            source_signal_type: 'followup_overdue',
            created_at: '2026-03-10T09:00:00.000Z',
          }),
        },
      ],
    });

    const out = await repository.getRecommendations({
      tenantId: 'tenant-1',
      status: 'open',
      priority: '90',
      type: 'schedule_contact',
      limit: 30,
    });

    expect(out.ok).toBe(true);
    expect(out.items[0]).toHaveProperty('signal_id', 'sig-1');
    expect(out.items[0]).toHaveProperty('source_signal_id', 'sig-1');

    const call = recommendationModel.findAndCountAll.mock.calls[0][0];
    expect(call.limit).toBe(30);
    expect(call.order).toEqual([['priority', 'DESC'], ['created_at', 'DESC']]);
    expect(call.where.tenant_key).toBe('tenant-1');
    expect(call.where.recommendation_type).toBe('schedule_contact');
    expect(call.where.status[Op.in]).toEqual(['open']);
    expect(call.where.priority).toBe(90);
  });

  test('getActivePlaybooks retorna execuções ativas ordenadas por started_at', async () => {
    playbookExecutionModel.findAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [
        {
          toJSON: () => ({
            id: 'run-1',
            tenant_key: 'tenant-1',
            playbook_id: 'followup_recovery',
            status: 'in_progress',
            current_step_index: 2,
            contact_id: 'contact-1',
            created_at: '2026-03-10T07:00:00.000Z',
            completed_at: null,
          }),
        },
      ],
    });

    const out = await repository.getActivePlaybooks({ tenantId: 'tenant-1', limit: 10 });

    expect(out.ok).toBe(true);
    expect(out.items[0]).toHaveProperty('current_step', 2);
    expect(out.items[0]).toHaveProperty('started_at', '2026-03-10T07:00:00.000Z');

    const call = playbookExecutionModel.findAndCountAll.mock.calls[0][0];
    expect(call.where.tenant_key).toBe('tenant-1');
    expect(call.where.status[Op.in]).toEqual(PLAYBOOK_ACTIVE_STATUSES);
    expect(call.order).toEqual([['created_at', 'DESC']]);
  });

  test('getOperationalKPIs agrega contadores e severity summary', async () => {
    signalModel.count
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);
    recommendationModel.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(6);
    playbookExecutionModel.count
      .mockResolvedValueOnce(2);

    const out = await repository.getOperationalKPIs('tenant-1');

    expect(out.ok).toBe(true);
    expect(out.kpis).toMatchObject({
      openSignals: 11,
      criticalSignals: 3,
      openRecommendations: 9,
      activePlaybooks: 2,
      signalsToday: 8,
      recommendationsToday: 6,
      severitySummary: {
        critical: 2,
        high: 4,
        medium: 3,
        low: 0,
      },
    });
  });

  test('getTopOperationalSignals agrega por tipo com count', async () => {
    signalModel.findAll.mockResolvedValueOnce([
      { type: 'low_occupancy', count: '5' },
      { type: 'support_backlog_risk', count: '3' },
    ]);

    const out = await repository.getTopOperationalSignals('tenant-1', { limit: 3 });

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([
      { type: 'low_occupancy', count: 5 },
      { type: 'support_backlog_risk', count: 3 },
    ]);

    const call = signalModel.findAll.mock.calls[0][0];
    expect(call.where.tenant_key).toBe('tenant-1');
    expect(call.limit).toBe(3);
  });
});

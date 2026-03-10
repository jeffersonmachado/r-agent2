'use strict';

const { OperationalOccQueryService } = require('../OperationalOccQueryService');

describe('OperationalOccQueryService', () => {
  test('delegates tenant signals to OCCOperationalStateRepository', async () => {
    const outcomeService = { listOutcomes: jest.fn() };
    const occStateRepository = {
      getSignals: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'sig-v2-1' }], total: 1, source: 'v2' }),
    };

    const service = new OperationalOccQueryService({
      outcomeService,
      occStateRepository,
    });

    const out = await service.listTenantSignals({
      tenantId: 'tenant-1',
      activeOnly: true,
      limit: 20,
      status: 'open',
      severity: 'critical',
      type: 'support_backlog_risk',
    });

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([{ id: 'sig-v2-1' }]);
    expect(occStateRepository.getSignals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      activeOnly: true,
      limit: 20,
      contactId: null,
      status: 'open',
      severity: 'critical',
      type: 'support_backlog_risk',
      from: null,
      to: null,
    });
  });

  test('returns repository errors for tenant signals', async () => {
    const occStateRepository = {
      getSignals: jest.fn().mockResolvedValue({ ok: false, error: 'db_unavailable' }),
    };

    const service = new OperationalOccQueryService({
      outcomeService: { listOutcomes: jest.fn() },
      occStateRepository,
    });

    const out = await service.listTenantSignals({ tenantId: 'tenant-1', status: 'open' });

    expect(out).toEqual({ ok: false, error: 'db_unavailable' });
  });

  test('enriquece sinais com último outcome quando includeOutcomes=true', async () => {
    const occStateRepository = {
      getSignals: jest.fn().mockResolvedValue({
        ok: true,
        items: [{ id: 'sig-1', detected_at: '2026-03-10T10:00:00.000Z' }],
        total: 1,
      }),
    };
    const outcomeService = {
      buildOccSignalOutcomeMap: jest.fn().mockResolvedValue({
        'sig-1': {
          lastOutcome: { id: 'out-1', status: 'success' },
          hasSuccessfulOutcome: true,
          timeToResolutionMs: 120000,
        },
      }),
      listOutcomes: jest.fn(),
    };

    const service = new OperationalOccQueryService({ outcomeService, occStateRepository });
    const out = await service.listTenantSignals({ tenantId: 'tenant-1', includeOutcomes: true });

    expect(out.ok).toBe(true);
    expect(out.items[0]).toMatchObject({
      id: 'sig-1',
      hasSuccessfulOutcome: true,
      timeToResolutionMs: 120000,
    });
    expect(outcomeService.buildOccSignalOutcomeMap).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      signalIds: ['sig-1'],
      signalDetectedAtById: { 'sig-1': '2026-03-10T10:00:00.000Z' },
    });
  });

  test('delegates tenant recommendations to OCCOperationalStateRepository', async () => {
    const recommendationQueryService = { listTenantRecommendations: jest.fn() };
    const occStateRepository = {
      getRecommendations: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'rec-v2-1' }], total: 1, source: 'v2' }),
    };

    const service = new OperationalOccQueryService({
      signalQueryService: { listTenantSignals: jest.fn() },
      recommendationQueryService,
      outcomeService: { listOutcomes: jest.fn() },
      occStateRepository,
    });

    const out = await service.listTenantRecommendations({
      tenantId: 'tenant-1',
      status: 'open',
      priority: '80',
      type: 'schedule_contact',
    });

    expect(out.ok).toBe(true);
    expect(occStateRepository.getRecommendations).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      limit: 200,
      contactId: null,
      status: 'open',
      priority: '80',
      type: 'schedule_contact',
      from: null,
      to: null,
    });
  });

  test('delegates KPI retrieval to OCCOperationalStateRepository', async () => {
    const kpiOut = {
      ok: true,
      kpis: {
        openSignals: 2,
        criticalSignals: 1,
        openRecommendations: 1,
        activePlaybooks: 1,
      },
      source: 'v2',
    };
    const service = new OperationalOccQueryService({
      outcomeService: { listOutcomes: jest.fn() },
      occStateRepository: {
        getOperationalKPIs: jest.fn().mockResolvedValue(kpiOut),
      },
    });

    const out = await service.getOperationalKPIs({ tenantId: 'tenant-1' });

    expect(out).toEqual(kpiOut);
  });

  test('delegates top signal types retrieval to OCCOperationalStateRepository', async () => {
    const topOut = {
      ok: true,
      items: [{ type: 'support_backlog_risk', count: 7 }],
      source: 'v2',
    };

    const service = new OperationalOccQueryService({
      outcomeService: { listOutcomes: jest.fn() },
      occStateRepository: {
        getTopOperationalSignals: jest.fn().mockResolvedValue(topOut),
      },
    });

    const out = await service.getTopOperationalSignals({
      tenantId: 'tenant-1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
      limit: 3,
    });

    expect(out).toEqual(topOut);
  });
});

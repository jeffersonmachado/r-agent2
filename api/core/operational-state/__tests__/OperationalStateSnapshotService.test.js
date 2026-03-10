'use strict';

const { OperationalStateSnapshotService } = require('..');

describe('OperationalStateSnapshotService', () => {
  test('gera snapshot canônico de estado operacional', async () => {
    const service = new OperationalStateSnapshotService({
      operationalStateService: {
        readState: jest.fn().mockResolvedValue({
          ok: true,
          signals: [{ id: 'sig-1' }],
          recommendations: [{ id: 'rec-1', status: 'open' }],
        }),
        listOutcomes: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'out-1' }],
        }),
      },
      occStateRepository: {
        getActivePlaybooks: jest.fn().mockResolvedValue({
          ok: true,
          items: [{ id: 'play-1' }],
        }),
      },
      metricsService: {
        getLatestTenantSnapshot: jest.fn().mockResolvedValue({
          ok: true,
          snapshot: {
            payload: {
              support: { openTickets: 3 },
              scheduling: { conflictsDetected: 2, cancelRate: 7 },
              ura: { fallbackCount: 1 },
              fitness: { occupancyRate: 40 },
            },
          },
        }),
      },
    });

    const out = await service.getSnapshot({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.snapshot.tenantId).toBe('tenant-1');
    expect(out.snapshot.backlog).toBe(2);
    expect(out.snapshot.waitingCustomers).toBe(3);
    expect(out.snapshot.capacityAvailability).toBe(60);
    expect(out.activeActions).toEqual([{ id: 'play-1' }]);
  });
});

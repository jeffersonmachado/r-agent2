'use strict';

const { AutonomousOperationsService } = require('../AutonomousOperationsService');

describe('AutonomousOperationsService', () => {
  test('anexa snapshot do kernel ao listar recomendações operacionais', async () => {
    const service = new AutonomousOperationsService({
      recommendationsService: {
        listRecommendations: jest.fn().mockResolvedValue({ ok: true, items: [{ id: 'rec-1' }] }),
      },
      kernel: {
        getStateSnapshot: jest.fn().mockResolvedValue({ ok: true, snapshot: { tenantId: 'tenant-1', backlog: 2 } }),
      },
    });

    const out = await service.listRecommendations({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.items).toEqual([{ id: 'rec-1' }]);
    expect(out.kernelState).toEqual({ tenantId: 'tenant-1', backlog: 2 });
  });

  test('anexa snapshot operacional ao preview run', async () => {
    const service = new AutonomousOperationsService({
      previewService: {
        previewRun: jest.fn().mockResolvedValue({ ok: true, preview: { wouldExecuteRealActions: false } }),
      },
      kernel: {
        getStateSnapshot: jest.fn().mockResolvedValue({ ok: true, snapshot: { tenantId: 'tenant-1', backlog: 5 } }),
      },
    });

    const out = await service.previewRun({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.preview.wouldExecuteRealActions).toBe(false);
    expect(out.preview.operationalStateSnapshot).toEqual({ tenantId: 'tenant-1', backlog: 5 });
  });
});

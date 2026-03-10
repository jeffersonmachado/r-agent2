'use strict';

const { OperationalPipelineService } = require('..');

describe('OperationalPipelineService', () => {
  test('despacha actions pelo sourceType canônico', async () => {
    const service = new OperationalPipelineService({
      actionService: {
        executeFromSignal: jest.fn().mockResolvedValue({ ok: true, action: { id: 'act-sig' } }),
        executeFromRecommendation: jest.fn().mockResolvedValue({ ok: true, action: { id: 'act-rec' } }),
      },
    });

    const signalOut = await service.executeAction({
      tenantId: 'tenant-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      actionId: 'notify_customer',
    });
    const recommendationOut = await service.executeAction({
      tenantId: 'tenant-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      actionId: 'notify_customer',
    });

    expect(signalOut.ok).toBe(true);
    expect(recommendationOut.ok).toBe(true);
  });

  test('expõe estado operacional via serviço canônico único', async () => {
    const service = new OperationalPipelineService({
      stateService: {
        getSnapshot: jest.fn().mockResolvedValue({
          ok: true,
          snapshot: {
            tenantId: 'tenant-1',
            backlog: 2,
          },
        }),
      },
    });

    const out = await service.getStateSnapshot({ tenantId: 'tenant-1' });
    expect(out.ok).toBe(true);
    expect(out.snapshot.backlog).toBe(2);
  });
});

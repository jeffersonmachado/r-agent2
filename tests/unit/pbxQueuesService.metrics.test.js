describe('pbxQueuesService.getQueueOperationalMetrics', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('agrega membros ativos/pausados por fila', async () => {
    const queueRows = [
      { id: 'q1', name: 'suporte', toJSON() { return this; } },
      { id: 'q2', name: 'vendas', toJSON() { return this; } },
    ];
    const memberRows = [
      { queueId: 'q1', memberType: 'extension', paused: false, toJSON() { return this; } },
      { queueId: 'q1', memberType: 'extension', paused: true, toJSON() { return this; } },
      { queueId: 'q2', memberType: 'external', paused: false, toJSON() { return this; } },
    ];

    jest.doMock('../../api/db/models', () => ({
      PbxQueue: () => ({ findAll: jest.fn(async () => queueRows) }),
      PbxQueueMember: () => ({ findAll: jest.fn(async () => memberRows) }),
    }));

    const svc = require('../../api/services/pbx/pbxQueuesService');
    const out = await svc.getQueueOperationalMetrics({ tenantKey: 't1' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.find((x) => x.queueId === 'q1')).toMatchObject({
      totalMembers: 2,
      pausedMembers: 1,
      activeMembers: 1,
    });
    expect(out.find((x) => x.queueId === 'q2')).toMatchObject({
      totalMembers: 1,
      pausedMembers: 0,
      activeMembers: 1,
    });
  });
});

'use strict';

const { handleFlowDelete } = require('../flowDeleteHandler');

describe('flowDeleteHandler', () => {
  test('remove flow e emite evento canônico de exclusão', async () => {
    const sendJson = jest.fn();
    const triggerWebhooks = jest.fn(() => Promise.resolve());
    const emitEvent = jest.fn();
    const deleteFlowBestEffort = jest.fn();
    const flows = new Map([['flow-1', { id: 'flow-1', name: 'Flow 1', tenantId: 'tenant-a' }]]);
    const req = { tenantId: 'tenant-a', agent: { id: 'agent-1' } };
    const res = {};

    await handleFlowDelete({
      id: 'flow-1',
      req,
      res,
      flows,
      strictTenantMode: false,
      requireAuth: () => ({ valid: true }),
      requireTenant: jest.fn(),
      sendJson,
      triggerWebhooks,
      emitEvent,
      deleteFlowBestEffort,
    });

    expect(flows.has('flow-1')).toBe(false);
    expect(deleteFlowBestEffort).toHaveBeenCalledWith('flow-1');
    expect(triggerWebhooks).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith(
      'flow.deleted',
      expect.objectContaining({ flowId: 'flow-1' }),
      { tenantId: 'tenant-a' }
    );
    expect(sendJson).toHaveBeenCalledWith(res, 200, { success: true, deletedId: 'flow-1' });
  });
});

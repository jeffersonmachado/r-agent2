/**
 * @fileoverview Contract tests for quick-actions route handlers without HTTP server dependency.
 */

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('Quick Actions API handler contracts', () => {
  let quickActionRegistry;
  let quickActionExecutor;

  const resolveQuickActionExecutionStatus = (out) => {
    const code = String(out?.error?.code || '').toUpperCase();
    if (code === 'ACTION_NOT_FOUND' || code === 'ACTION_REQUIRED' || code === 'SOURCE_REQUIRED' || code === 'TENANT_REQUIRED') {
      return 422;
    }
    return 400;
  };

  const isSuperAdmin = (req, res, next) => {
    if (req.user?.roles?.includes('super_admin')) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };

  const listSignalQuickActions = (req, res) => {
    const { signalId } = req.params;
    const actions = quickActionRegistry.getActionsForSignal({ id: signalId });
    return res.json({ ok: true, items: actions });
  };

  const executeSignalQuickAction = async (req, res) => {
    const { id: tenantId, signalId, actionId } = req.params;
    const result = await quickActionExecutor.executeForSignal({
      tenantId,
      signalId,
      actionId,
      input: req.body?.input || {},
      actorType: req.user?.type || 'user',
      actorId: req.user?.id || '',
    });
    return res.status(result?.ok ? 200 : resolveQuickActionExecutionStatus(result)).json(result);
  };

  const listRecommendationQuickActions = (req, res) => {
    const { recommendationId } = req.params;
    const actions = quickActionRegistry.getActionsForRecommendation({ id: recommendationId });
    return res.json({ ok: true, items: actions });
  };

  const executeRecommendationQuickAction = async (req, res) => {
    const { id: tenantId, recommendationId, actionId } = req.params;
    const result = await quickActionExecutor.executeForRecommendation({
      tenantId,
      recommendationId,
      actionId,
      input: req.body?.input || {},
      actorType: req.user?.type || 'user',
      actorId: req.user?.id || '',
    });
    return res.status(result?.ok ? 200 : resolveQuickActionExecutionStatus(result)).json(result);
  };

  beforeEach(() => {
    quickActionRegistry = {
      getActionsForSignal: jest.fn().mockReturnValue([{ id: 'open_followup' }]),
      getActionsForRecommendation: jest.fn().mockReturnValue([{ id: 'create_opportunity' }]),
    };

    quickActionExecutor = {
      executeForSignal: jest.fn().mockResolvedValue({ ok: true, result: { id: 'ok-signal' } }),
      executeForRecommendation: jest.fn().mockResolvedValue({ ok: true, result: { id: 'ok-rec' } }),
    };
  });

  test('isSuperAdmin allows and blocks access correctly', () => {
    const allowReq = { user: { roles: ['super_admin'] } };
    const denyReq = { user: { roles: ['agent'] } };
    const allowRes = createRes();
    const denyRes = createRes();
    const next = jest.fn();

    isSuperAdmin(allowReq, allowRes, next);
    expect(next).toHaveBeenCalledTimes(1);

    isSuperAdmin(denyReq, denyRes, jest.fn());
    expect(denyRes.statusCode).toBe(403);
    expect(denyRes.body).toEqual({ ok: false, error: 'Forbidden' });
  });

  test('list signal quick actions returns normalized payload', () => {
    const req = {
      params: { id: 'tenant-1', signalId: 'sig-1' },
      user: { id: 'user-1', type: 'agent', roles: ['super_admin'] },
    };
    const res = createRes();

    listSignalQuickActions(req, res);

    expect(quickActionRegistry.getActionsForSignal).toHaveBeenCalledWith({ id: 'sig-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, items: [{ id: 'open_followup' }] });
  });

  test('execute signal quick action passes normalized input to executor', async () => {
    const req = {
      params: { id: 'tenant-1', signalId: 'sig-1', actionId: 'open_followup' },
      body: { input: { note: 'hello' } },
      user: { id: 'user-1', type: 'agent', roles: ['super_admin'] },
    };
    const res = createRes();

    await executeSignalQuickAction(req, res);

    expect(quickActionExecutor.executeForSignal).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      signalId: 'sig-1',
      actionId: 'open_followup',
      input: { note: 'hello' },
      actorType: 'agent',
      actorId: 'user-1',
    });
    expect(res.body).toEqual({ ok: true, result: { id: 'ok-signal' } });
  });

  test('list recommendation quick actions returns normalized payload', () => {
    const req = {
      params: { id: 'tenant-1', recommendationId: 'rec-1' },
      user: { id: 'user-1', type: 'agent', roles: ['super_admin'] },
    };
    const res = createRes();

    listRecommendationQuickActions(req, res);

    expect(quickActionRegistry.getActionsForRecommendation).toHaveBeenCalledWith({ id: 'rec-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, items: [{ id: 'create_opportunity' }] });
  });

  test('execute recommendation quick action passes normalized input to executor', async () => {
    const req = {
      params: { id: 'tenant-1', recommendationId: 'rec-1', actionId: 'create_opportunity' },
      body: { input: { title: 'Upsell VIP' } },
      user: { id: 'user-1', type: 'agent', roles: ['super_admin'] },
    };
    const res = createRes();

    await executeRecommendationQuickAction(req, res);

    expect(quickActionExecutor.executeForRecommendation).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      recommendationId: 'rec-1',
      actionId: 'create_opportunity',
      input: { title: 'Upsell VIP' },
      actorType: 'agent',
      actorId: 'user-1',
    });
    expect(res.body).toEqual({ ok: true, result: { id: 'ok-rec' } });
  });

  test('execute signal quick action returns 422 for invalid execution payload', async () => {
    quickActionExecutor.executeForSignal.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'ACTION_REQUIRED',
        message: 'actionId é obrigatório',
      },
    });

    const req = {
      params: { id: 'tenant-1', signalId: 'sig-1', actionId: '' },
      body: { input: {} },
      user: { id: 'user-1', type: 'agent', roles: ['super_admin'] },
    };
    const res = createRes();

    await executeSignalQuickAction(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      error: {
        code: 'ACTION_REQUIRED',
        message: 'actionId é obrigatório',
      },
    });
  });
});

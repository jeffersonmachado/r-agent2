describe('onboardingRoutes handler', () => {
  let handleOnboardingRoutes;

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      getOnboardingStatus: jest.fn(() => ({ tenantId: 'tenant1', steps: [] })),
      startOnboarding: jest.fn(() => ({ success: true, onboarding: {} })),
      completeOnboardingStep: jest.fn(() => ({ success: true })),
      completeOnboarding: jest.fn(async () => ({ success: true })),
      createInitialTemplates: jest.fn(async () => ({ success: true, templates: [] })),
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      tenantId: 'tenant1',
      agent: { id: 'a1', username: 'alice', role: 'admin' },
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handleOnboardingRoutes = require('../../api/serverHandlers/onboardingRoutes').handleOnboardingRoutes;
  });

  // ── rota não tratada ────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleOnboardingRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });
    expect(handled).toBe(false);
  });

  // ── GET /onboarding/status ──────────────────────────────────────────────

  test('GET /onboarding/status retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'GET', pathname: '/onboarding/status', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /onboarding/status retorna 403 sem tenantId', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleOnboardingRoutes({ req: makeReq({ tenantId: null }), res, method: 'GET', pathname: '/onboarding/status', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'tenant_id_required' }));
  });

  test('GET /onboarding/status retorna 404 se tenant nao encontrado', async () => {
    const res = {};
    const deps = makeDeps({ getOnboardingStatus: jest.fn(() => null) });
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'GET', pathname: '/onboarding/status', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'tenant_not_found' }));
  });

  test('GET /onboarding/status retorna status do onboarding', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'GET', pathname: '/onboarding/status', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ onboarding: expect.any(Object) }));
  });

  // ── POST /onboarding/start ──────────────────────────────────────────────

  test('POST /onboarding/start retorna 403 para role agent', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleOnboardingRoutes({ req, res, method: 'POST', pathname: '/onboarding/start', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('POST /onboarding/start inicia onboarding para owner', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'owner' } });
    const handled = await handleOnboardingRoutes({ req, res, method: 'POST', pathname: '/onboarding/start', deps });
    expect(handled).toBe(true);
    expect(deps.startOnboarding).toHaveBeenCalledWith('tenant1');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  // ── POST /onboarding/complete-step ─────────────────────────────────────

  test('POST /onboarding/complete-step retorna 400 sem stepId', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'POST', pathname: '/onboarding/complete-step', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /onboarding/complete-step completa o passo e loga acao', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ stepId: 'step_1' })) });
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'POST', pathname: '/onboarding/complete-step', deps });
    expect(handled).toBe(true);
    expect(deps.completeOnboardingStep).toHaveBeenCalledWith('tenant1', 'step_1');
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  // ── POST /onboarding/complete ───────────────────────────────────────────

  test('POST /onboarding/complete retorna 403 para supervisor', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'supervisor' } });
    const handled = await handleOnboardingRoutes({ req, res, method: 'POST', pathname: '/onboarding/complete', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('POST /onboarding/complete finaliza onboarding e loga', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'POST', pathname: '/onboarding/complete', deps });
    expect(handled).toBe(true);
    expect(deps.completeOnboarding).toHaveBeenCalledWith('tenant1');
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  // ── POST /onboarding/create-templates ──────────────────────────────────

  test('POST /onboarding/create-templates retorna 403 para agent', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleOnboardingRoutes({ req, res, method: 'POST', pathname: '/onboarding/create-templates', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('POST /onboarding/create-templates cria templates com sucesso', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleOnboardingRoutes({ req: makeReq(), res, method: 'POST', pathname: '/onboarding/create-templates', deps });
    expect(handled).toBe(true);
    expect(deps.createInitialTemplates).toHaveBeenCalledWith('tenant1', expect.any(Object));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });
});

describe('agentRoutes handler', () => {
  let handleAgentRoutes;

  function makeDeps(overrides = {}) {
    const agentObj = { id: 'a1', username: 'alice', tenantId: 'tenant1', role: 'agent' };
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listAgents: jest.fn(async () => [agentObj]),
      createAgent: jest.fn(async () => ({ success: true, agent: agentObj })),
      getAgent: jest.fn(async () => agentObj),
      updateAgent: jest.fn(async () => ({ success: true, agent: agentObj })),
      deleteAgent: jest.fn(async () => ({ success: true })),
      inviteUser: jest.fn(async () => ({ success: true, agentId: 'a2' })),
      acceptInvitation: jest.fn(async () => ({ success: true, agent: agentObj })),
      requestPasswordReset: jest.fn(async () => {}),
      resetPassword: jest.fn(async () => ({ success: true })),
      setupMfa: jest.fn(async () => ({ ok: true, secret: 'sec', qrCode: 'qr' })),
      verifyMfa: jest.fn(async () => ({ ok: true })),
      disableMfa: jest.fn(async () => ({ ok: true })),
      consumeRecoveryCode: jest.fn(async () => ({ ok: true, remaining: 7 })),
      isSuperAdmin: jest.fn(() => false),
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
    handleAgentRoutes = require('../../api/modules/domain-identity/handleAgentRoutes').handleAgentRoutes;
  });

  // ── rota não tratada ────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleAgentRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });
    expect(handled).toBe(false);
  });

  // ── GET /auth/agents ────────────────────────────────────────────────────

  test('GET /auth/agents retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'GET', pathname: '/auth/agents', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /auth/agents retorna 403 sem permissao', async () => {
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'GET', pathname: '/auth/agents', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /auth/agents lista agentes do tenant', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'GET', pathname: '/auth/agents', deps });
    expect(handled).toBe(true);
    expect(deps.listAgents).toHaveBeenCalledWith('tenant1');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ agents: expect.any(Array) }));
  });

  // ── POST /auth/agents ───────────────────────────────────────────────────

  test('POST /auth/agents cria agente e loga', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ username: 'bob', role: 'agent' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/agents', deps });
    expect(handled).toBe(true);
    expect(deps.createAgent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant1' }));
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.any(Object));
  });

  // ── GET /auth/agents/:id ────────────────────────────────────────────────

  test('GET /auth/agents/:id retorna 403 quando agent tenta ver outro agente', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleAgentRoutes({ req, res, method: 'GET', pathname: '/auth/agents/a2', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /auth/agents/:id retorna proprio perfil para agent', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleAgentRoutes({ req, res, method: 'GET', pathname: '/auth/agents/a1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ agent: expect.any(Object) }));
  });

  test('GET /auth/agents/:id retorna 404 se nao encontrado', async () => {
    const res = {};
    const deps = makeDeps({ getAgent: jest.fn(async () => null) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'GET', pathname: '/auth/agents/a99', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'agent_not_found' }));
  });

  // ── PUT /auth/agents/:id ────────────────────────────────────────────────

  test('PUT /auth/agents/:id atualiza e loga', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ username: 'alice2' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'PUT', pathname: '/auth/agents/a1', deps });
    expect(handled).toBe(true);
    expect(deps.updateAgent).toHaveBeenCalled();
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  test('PUT /auth/agents/:id nao permite agent mudar role/active do proprio perfil', async () => {
    const res = {};
    const body = { username: 'alice2', role: 'admin', active: false };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ ...body })) });
    const req = makeReq({ agent: { id: 'a1', username: 'alice', role: 'agent' } });
    const handled = await handleAgentRoutes({ req, res, method: 'PUT', pathname: '/auth/agents/a1', deps });
    expect(handled).toBe(true);
    // role and active should be stripped from the call
    const callArgs = deps.updateAgent.mock.calls[0][1];
    expect(callArgs.role).toBeUndefined();
    expect(callArgs.active).toBeUndefined();
  });

  test('PUT /auth/agents/:id super-admin pode editar agente de outro tenant', async () => {
    const res = {};
    const foreignAgent = { id: 'a2', username: 'bob', tenantId: 'tenant2', role: 'agent' };
    const deps = makeDeps({
      getAgent: jest.fn(async () => foreignAgent),
      isSuperAdmin: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({ username: 'bob2' })),
    });
    const req = makeReq({ tenantId: 'tenant1' });
    const handled = await handleAgentRoutes({ req, res, method: 'PUT', pathname: '/auth/agents/a2', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.any(Object));
  });

  // ── DELETE /auth/agents/:id ─────────────────────────────────────────────

  test('DELETE /auth/agents/:id remove e loga', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'DELETE', pathname: '/auth/agents/a1', deps });
    expect(handled).toBe(true);
    expect(deps.deleteAgent).toHaveBeenCalledWith('a1');
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── POST /auth/invite ───────────────────────────────────────────────────

  test('POST /auth/invite convida usuario e loga', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ email: 'bob@ex.com', role: 'agent' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/invite', deps });
    expect(handled).toBe(true);
    expect(deps.inviteUser).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant1' }));
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── POST /auth/accept-invitation ────────────────────────────────────────

  test('POST /auth/accept-invitation retorna 400 sem campos obrigatorios', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ invitationToken: 'tok' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/accept-invitation', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /auth/accept-invitation aceita convite sem requireAuth', async () => {
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ invitationToken: 'tok', password: 'pass', username: 'bob' })),
    });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/accept-invitation', deps });
    expect(handled).toBe(true);
    expect(deps.requireAuth).not.toHaveBeenCalled();
    expect(deps.acceptInvitation).toHaveBeenCalledWith('tok', 'pass', 'bob');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── POST /auth/request-password-reset ──────────────────────────────────

  test('POST /auth/request-password-reset retorna sucesso mesmo sem email existente', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ email: 'any@ex.com' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/request-password-reset', deps });
    expect(handled).toBe(true);
    expect(deps.requireAuth).not.toHaveBeenCalled();
    expect(deps.requestPasswordReset).toHaveBeenCalledWith('any@ex.com');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── POST /auth/reset-password ───────────────────────────────────────────

  test('POST /auth/reset-password retorna 400 sem campos obrigatorios', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ resetToken: 'tok' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/reset-password', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /auth/reset-password reseta senha', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ resetToken: 'tok', newPassword: 'newpass' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/reset-password', deps });
    expect(handled).toBe(true);
    expect(deps.resetPassword).toHaveBeenCalledWith('tok', 'newpass');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  // ── POST /auth/mfa/setup ────────────────────────────────────────────────

  test('POST /auth/mfa/setup inicia setup e retorna qrCode', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ issuer: 'RIA', label: 'alice' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/setup', deps });
    expect(handled).toBe(true);
    expect(deps.setupMfa).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('POST /auth/mfa/setup retorna 400 se setup falha', async () => {
    const res = {};
    const deps = makeDeps({ setupMfa: jest.fn(async () => ({ ok: false, error: 'already_enabled' })) });
    const deps2 = { ...deps, parseJsonBody: jest.fn(async () => ({})) };
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/setup', deps: deps2 });
    expect(handled).toBe(true);
    expect(deps2.sendJson).toHaveBeenCalledWith(res, 400, expect.objectContaining({ error: 'already_enabled' }));
  });

  // ── POST /auth/mfa/verify ───────────────────────────────────────────────

  test('POST /auth/mfa/verify retorna 400 sem token', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/verify', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /auth/mfa/verify verifica token MFA', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ token: '123456' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/verify', deps });
    expect(handled).toBe(true);
    expect(deps.verifyMfa).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1', token: '123456' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  // ── POST /auth/mfa/disable ──────────────────────────────────────────────

  test('POST /auth/mfa/disable retorna 400 sem token ou recoveryCode', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/disable', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /auth/mfa/disable desativa MFA com token', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ token: '654321' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/disable', deps });
    expect(handled).toBe(true);
    expect(deps.disableMfa).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  // ── POST /auth/mfa/recovery ─────────────────────────────────────────────

  test('POST /auth/mfa/recovery retorna 400 sem code', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/recovery', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /auth/mfa/recovery consome recovery code', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ code: 'R123ABC' })) });
    const handled = await handleAgentRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/mfa/recovery', deps });
    expect(handled).toBe(true);
    expect(deps.consumeRecoveryCode).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1', code: 'R123ABC' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, remaining: 7 }));
  });
});

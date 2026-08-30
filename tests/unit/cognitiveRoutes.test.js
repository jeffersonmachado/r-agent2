/**
 * Testes unitários: rotas do Cognitive Core (/api/cognitive/*).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { handleCognitiveRoutes, _internal } = require('../../api/modules/cognitive/routes');

function buildDeps(overrides = {}) {
  const sent = [];
  const deps = {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
    badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    cognitiveOrchestrator: {
      process: jest.fn(async (args) => ({ executionId: 'e1', tenantId: args.tenantId, status: 'completed', intent: 'agendar' })),
      toolRegistry: { list: jest.fn(() => [{ id: 'searchCustomer', visibility: 'PRODUCTION' }]) },
    },
    ...overrides,
  };
  return { deps, sent };
}

function buildCtx({ method = 'POST', pathname = '/api/cognitive/process', agent, tenantId = 'tenant-a', deps }) {
  return {
    req: { agent: agent || { id: 'u1', role: 'operator', tenantId }, tenant_id: tenantId },
    res: { writableEnded: true },
    method,
    pathname,
    deps,
  };
}

describe('Cognitive Core — rotas /api/cognitive', () => {
  test('ignora rotas fora do prefixo', async () => {
    const { deps } = buildDeps();
    const handled = await handleCognitiveRoutes(buildCtx({ pathname: '/api/other', deps }));
    expect(handled).toBe(false);
  });

  test('exige autenticação', async () => {
    const { deps, sent } = buildDeps({ requireAuth: jest.fn(() => ({ valid: false })) });
    const handled = await handleCognitiveRoutes(buildCtx({ deps }));
    expect(handled).toBe(true);
    expect(sent[0].code).toBe(401);
  });

  test('exige permissão ai/execute', async () => {
    const { deps, sent } = buildDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'denied' })) });
    await handleCognitiveRoutes(buildCtx({ deps }));
    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'ai', 'execute');
    expect(sent[0].code).toBe(403);
  });

  test('process: exige tenant e message/eventType', async () => {
    const { deps, sent } = buildDeps({ parseJsonBody: jest.fn(async () => ({})) });
    await handleCognitiveRoutes(buildCtx({ deps, tenantId: '' }));
    expect(sent[0].data.error).toBe('tenant_required');

    const { deps: deps2, sent: sent2 } = buildDeps({ parseJsonBody: jest.fn(async () => ({})) });
    await handleCognitiveRoutes(buildCtx({ deps: deps2 }));
    expect(sent2[0].data.error).toBe('message or eventType is required');
  });

  test('process: chama o orchestrator com tenant e ator do request', async () => {
    const { deps, sent } = buildDeps({
      parseJsonBody: jest.fn(async () => ({ message: 'quero remarcar minha consulta', channel: 'whatsapp' })),
    });
    const handled = await handleCognitiveRoutes(buildCtx({ deps }));
    expect(handled).toBe(true);
    expect(deps.cognitiveOrchestrator.process).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      message: 'quero remarcar minha consulta',
      actor: expect.objectContaining({ classification: 'PRODUCTION' }),
    }));
    expect(sent[0].code).toBe(200);
    expect(sent[0].data.ok).toBe(true);
    expect(sent[0].data.result.status).toBe('completed');
  });

  test('process: erro do pipeline vira 500 sem vazar stack', async () => {
    const { deps, sent } = buildDeps({
      parseJsonBody: jest.fn(async () => ({ message: 'x' })),
      cognitiveOrchestrator: {
        process: jest.fn(async () => { throw new Error('boom'); }),
        toolRegistry: { list: jest.fn(() => []) },
      },
    });
    await handleCognitiveRoutes(buildCtx({ deps }));
    expect(sent[0].code).toBe(500);
    expect(sent[0].data.error).toBe('cognitive_process_failed');
  });

  test('GET /intents devolve a taxonomia', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({ method: 'GET', pathname: '/api/cognitive/intents', deps }));
    expect(sent[0].data.intents).toContain('agendar');
    expect(sent[0].data.intents).toHaveLength(11);
  });

  test('GET /tools nega Tool Registry técnico a PRODUCTION (403)', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({ method: 'GET', pathname: '/api/cognitive/tools', deps }));
    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(sent[0].data.required).toBe('DEVELOPMENT');
    expect(sent[0].data.classification).toBe('PRODUCTION');
    expect(deps.cognitiveOrchestrator.toolRegistry.list).not.toHaveBeenCalled();
  });

  test('GET /tools nega Tool Registry técnico a auditor de tenant puro (PRODUCTION → 403)', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({
      method: 'GET',
      pathname: '/api/cognitive/tools',
      agent: { id: 'u2', role: 'auditor', tenantId: 'tenant-a' },
      deps,
    }));
    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(deps.cognitiveOrchestrator.toolRegistry.list).not.toHaveBeenCalled();
  });

  test('GET /tools nega Tool Registry técnico a SUPPORT (platformRole support → 403)', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({
      method: 'GET',
      pathname: '/api/cognitive/tools',
      agent: { id: 'u2', role: 'auditor', platformRole: 'support_n2', tenantId: 'tenant-a' },
      deps,
    }));
    expect(sent[0].code).toBe(403);
    expect(sent[0].data.error).toBe('classification_required');
    expect(sent[0].data.classification).toBe('SUPPORT');
    expect(deps.cognitiveOrchestrator.toolRegistry.list).not.toHaveBeenCalled();
  });

  test('GET /tools mantém acesso a DEVELOPMENT (super_admin)', async () => {
    const { deps, sent } = buildDeps();
    await handleCognitiveRoutes(buildCtx({
      method: 'GET',
      pathname: '/api/cognitive/tools',
      agent: { id: 'u3', role: 'super_admin', tenantId: 'tenant-a' },
      deps,
    }));
    expect(deps.cognitiveOrchestrator.toolRegistry.list).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'DEVELOPMENT' }),
    );
    expect(sent[0].code).toBe(200);
    expect(sent[0].data.tools).toEqual([{ id: 'searchCustomer', visibility: 'PRODUCTION' }]);
  });

  describe('GET /capabilities — business capability view', () => {
    test('PRODUCTION recebe 200 com payload sem campos técnicos', async () => {
      const { deps, sent } = buildDeps();
      await handleCognitiveRoutes(buildCtx({ method: 'GET', pathname: '/api/cognitive/capabilities', deps }));
      expect(sent[0].code).toBe(200);
      expect(Array.isArray(sent[0].data.capabilities)).toBe(true);
      expect(sent[0].data.capabilities.length).toBeGreaterThan(0);
      for (const cap of sent[0].data.capabilities) {
        expect(Object.keys(cap).sort()).toEqual(['description', 'id', 'name']);
        expect(cap).not.toHaveProperty('inputSchema');
        expect(cap).not.toHaveProperty('outputSchema');
        expect(cap).not.toHaveProperty('riskLevel');
        expect(cap).not.toHaveProperty('sideEffects');
        expect(cap).not.toHaveProperty('permissions');
        expect(cap).not.toHaveProperty('tools');
        expect(cap).not.toHaveProperty('confirmationPolicy');
        expect(cap).not.toHaveProperty('idempotencyPolicy');
        expect(cap).not.toHaveProperty('executionMode');
      }
    });

    test('capabilities filtradas por visibility: PRODUCTION não vê DEVELOPMENT-only', async () => {
      const { deps, sent } = buildDeps();
      await handleCognitiveRoutes(buildCtx({ method: 'GET', pathname: '/api/cognitive/capabilities', deps }));
      const ids = sent[0].data.capabilities.map((c) => c.id);
      expect(ids).toContain('crm.read');
      expect(ids).not.toContain('qa.waves');
      expect(ids).not.toContain('qa.mesh');
      expect(ids).not.toContain('audit.replay');

      const { deps: depsDev, sent: sentDev } = buildDeps();
      await handleCognitiveRoutes(buildCtx({
        method: 'GET',
        pathname: '/api/cognitive/capabilities',
        agent: { id: 'u3', role: 'super_admin', tenantId: 'tenant-a' },
        deps: depsDev,
      }));
      const devIds = sentDev[0].data.capabilities.map((c) => c.id);
      expect(devIds).toContain('qa.waves');
      expect(devIds).toContain('crm.read');
    });

    test('exige permissão ai/execute', async () => {
      const { deps, sent } = buildDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'denied' })) });
      await handleCognitiveRoutes(buildCtx({ method: 'GET', pathname: '/api/cognitive/capabilities', deps }));
      expect(sent[0].code).toBe(403);
    });
  });

  describe('mapeamento de ator', () => {
    test('classificação por papel: super_admin=DEVELOPMENT, auditor de tenant=PRODUCTION, platformRole support=SUPPORT', () => {
      expect(_internal.resolveActorClassification({ role: 'super_admin' })).toBe('DEVELOPMENT');
      expect(_internal.resolveActorClassification({ role: 'auditor' })).toBe('PRODUCTION');
      expect(_internal.resolveActorClassification({ role: 'auditor', platformRole: 'support_n2' })).toBe('SUPPORT');
      expect(_internal.resolveActorClassification({ role: 'operator' })).toBe('PRODUCTION');
      expect(_internal.resolveActorClassification({ role: 'admin' })).toBe('PRODUCTION');
    });

    test('permissões de tools derivadas do RBAC real', () => {
      const operator = { role: 'operator' };
      const perms = _internal.resolveActorToolPermissions(operator);
      // operator tem ai/execute e crm/read no RBAC
      expect(perms).toEqual(expect.arrayContaining(['agenda.write', 'channel.send', 'ticket.write', 'conversation.transfer']));

      const readonly = { role: 'readonly' };
      const readonlyPerms = _internal.resolveActorToolPermissions(readonly);
      expect(readonlyPerms).not.toContain('agenda.write');
      expect(readonlyPerms).not.toContain('campaign.write');

      expect(_internal.resolveActorToolPermissions({ role: 'super_admin' })).toEqual(['*']);
    });
  });
});

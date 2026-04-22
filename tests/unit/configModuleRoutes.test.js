'use strict';

const { createConfigService } = require('../../api/modules/config/service');
const { createConfigController } = require('../../api/modules/config/controller');
const { createConfigRoutes } = require('../../api/modules/config/routes');

describe('config module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true, agent: { id: 'a1', tenantId: 'tenant-1', role: 'admin' } })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      saveAIConfig: jest.fn(async () => ({ ok: true })),
      saveAICredentials: jest.fn(async () => ({ ok: true })),
      getDecryptedAPIKey: jest.fn(async () => ''),
      initializeAiProviders: jest.fn(),
      isSuperAdmin: jest.fn(() => false),
      setCorsHeaders: jest.fn(),
      emitEvent: jest.fn(),
      detectProcessManager: jest.fn(() => ({ name: 'none', hasProcessManager: false, details: {} })),
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createConfigRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/config',
      '/contracts/rag/question-generation.rules.json',
      '/api/data/rag_question_generation_rules.json',
      '/tenants/current/ai-config',
      '/tenants/current/ai-config',
      '/tenants/current/ai-credentials',
      '/tenants/:tenantKey/ai-credentials/test',
      '/config',
      '/server/process-manager',
      '/config/validate-provider-token',
      '/config/validate-redis',
      '/server/restart',
    ]);
  });

  test('controller validateProviderToken mantém badRequest sem campos obrigatórios', async () => {
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ provider: 'openai' })) });
    const service = createConfigService({ deps });
    const controller = createConfigController({ service, deps });

    await controller.validateProviderToken({}, {});

    expect(deps.badRequest).toHaveBeenCalledWith({}, 'Provider e apiKey são obrigatórios');
  });

  test('controller getProcessManager preserva contrato de resposta', async () => {
    const deps = makeDeps({
      detectProcessManager: jest.fn(() => ({ name: 'nodemon', hasProcessManager: true, details: { exec: 'nodemon' } })),
    });
    const service = createConfigService({ deps });
    const controller = createConfigController({ service, deps });
    const res = {};

    await controller.getProcessManager({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      success: true,
      processManager: 'nodemon',
      hasProcessManager: true,
      details: { exec: 'nodemon' },
    });
  });
});

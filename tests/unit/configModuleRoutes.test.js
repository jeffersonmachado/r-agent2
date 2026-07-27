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

  describe('endpoints sensíveis exigem autenticação (regressão de segurança)', () => {
    // Falha observada na sondagem real: GET /config vazava database.url com
    // credenciais sem token; PUT /config aceitava sobrescrita total anônima;
    // POST /server/restart executava process.exit(0) sem qualquer guarda;
    // validate-provider-token/validate-redis eram oracle/SSRF abertos.
    function makeUnauthDeps() {
      return makeDeps({
        requireAuth: jest.fn(() => ({ valid: false, error: 'Token ausente' })),
      });
    }

    test('GET /config sem auth → 200 com visão pública sanitizada (sem credenciais)', async () => {
      const deps = makeUnauthDeps();
      const service = createConfigService({ deps });
      const fullSpy = jest.spyOn(service, 'reloadAndReadConfig');
      const publicSpy = jest.spyOn(service, 'readPublicConfig');
      const controller = createConfigController({ service, deps });
      const res = {};
      const req = { headers: { accept: 'application/json' } };

      await controller.getConfig(req, res);

      expect(publicSpy).toHaveBeenCalledTimes(1);
      expect(fullSpy).not.toHaveBeenCalled();
    });

    test('PUT /config sem auth → 401 e não persiste', async () => {
      const deps = makeUnauthDeps();
      const service = createConfigService({ deps });
      const controller = createConfigController({ service, deps });
      const res = {};

      await controller.updateConfig({ headers: {} }, res);

      expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
      expect(deps.parseJsonBody).not.toHaveBeenCalled();
    });

    test('POST /server/restart sem auth → 401 e NÃO agenda encerramento do processo', async () => {
      jest.useFakeTimers();
      try {
        const deps = makeUnauthDeps();
        const service = createConfigService({ deps });
        const controller = createConfigController({ service, deps });
        const res = {};
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

        await controller.restartServer({ headers: {} }, res);
        jest.runAllTimers();

        expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
        expect(exitSpy).not.toHaveBeenCalled();
        exitSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    test('POST /config/validate-provider-token sem auth → 401 (oracle fechado)', async () => {
      const deps = makeUnauthDeps();
      const service = createConfigService({ deps });
      const controller = createConfigController({ service, deps });
      const res = {};

      await controller.validateProviderToken({ headers: {} }, res);

      expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
      expect(deps.parseJsonBody).not.toHaveBeenCalled();
    });

    test('POST /config/validate-redis sem auth → 401 (SSRF fechado)', async () => {
      const deps = makeUnauthDeps();
      const service = createConfigService({ deps });
      const controller = createConfigController({ service, deps });
      const res = {};

      await controller.validateRedis({ headers: {} }, res);

      expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
      expect(deps.parseJsonBody).not.toHaveBeenCalled();
    });

    test('PUT /config sem permissão config:update → 403', async () => {
      const deps = makeDeps({
        requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissão' })),
      });
      const service = createConfigService({ deps });
      const controller = createConfigController({ service, deps });
      const res = {};

      await controller.updateConfig({ headers: {} }, res);

      expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
      expect(deps.parseJsonBody).not.toHaveBeenCalled();
    });
  });
});

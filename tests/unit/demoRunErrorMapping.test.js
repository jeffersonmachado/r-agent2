/**
 * Regressão: POST /api/demo/run não pode mascarar erros codificados como 500 genérico.
 *
 * Falha observada (2026-07-27): POST /api/demo/run retornava
 *   500 {"error":"internal_error","message":"Error running demo flow"}
 * quando o cenário do demo só é executável no pipeline oficial. A causa real
 * (MISSING_PLATFORM_SCENARIO_IDS / PIPELINE_ONLY_SCENARIO / BAD_REQUEST)
 * era engolida pelo catch genérico, impossibilitando diagnóstico.
 *
 * Comportamento correto:
 *  - NOT_FOUND -> 404
 *  - BAD_REQUEST -> 400 com details
 *  - MISSING_PLATFORM_SCENARIO_IDS / PIPELINE_ONLY_SCENARIO -> 422 com code e message reais
 *  - demais erros -> 500
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('demo routes — mapeamento de erros do /api/demo/run', () => {
  function buildRouter(orchestratorError) {
    // eslint-disable-next-line global-require
    const { createDemoRoutes } = require('../../api/modules/demo/routes');
    return createDemoRoutes({
      buildDeps: () => ({
        requireAuth: () => ({ valid: true, agent: { id: 'agent-1', tenantId: 'system' } }),
        sendJson: (res, status, payload) => {
          res.status(status).json(payload);
        },
        badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
        hasJsonContentType: () => true,
        parseJsonBody: async () => ({}),
        logger: { error: jest.fn() },
        demoOrchestrator: {
          runDemo: async () => {
            throw orchestratorError;
          },
        },
      }),
    });
  }

  async function invokeRun(router) {
    const layer = router.stack.find((l) => l.route && l.route.path === '/api/demo/run' && l.route.methods.post);
    const handler = layer.route.stack[0].handle;
    const req = { query: {}, token: 't', headers: { 'content-type': 'application/json' } };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    await handler(req, res);
    return res;
  }

  test('NOT_FOUND -> 404', async () => {
    const err = new Error('sem cenario'); err.code = 'NOT_FOUND';
    const res = await invokeRun(buildRouter(err));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  test('BAD_REQUEST -> 400 com message real', async () => {
    const err = new Error('Scenario com status nao executavel: x'); err.code = 'BAD_REQUEST'; err.details = { status: 'draft' };
    const res = await invokeRun(buildRouter(err));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('status nao executavel');
    expect(res.body.details).toEqual({ status: 'draft' });
  });

  test('PIPELINE_ONLY_SCENARIO -> 422 com code e message reais', async () => {
    const err = new Error('Cenário "demo" só é executável no pipeline oficial'); err.code = 'PIPELINE_ONLY_SCENARIO';
    const res = await invokeRun(buildRouter(err));
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('demo_run_unavailable');
    expect(res.body.code).toBe('PIPELINE_ONLY_SCENARIO');
    expect(res.body.message).toContain('pipeline oficial');
  });

  test('MISSING_PLATFORM_SCENARIO_IDS -> 422', async () => {
    const err = new Error('requer platformScenarioIds explícito'); err.code = 'MISSING_PLATFORM_SCENARIO_IDS';
    const res = await invokeRun(buildRouter(err));
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('MISSING_PLATFORM_SCENARIO_IDS');
  });

  test('erro desconhecido -> 500 genérico', async () => {
    const res = await invokeRun(buildRouter(new Error('boom')));
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});

describe('qaWavesScenarioService — inferPlatformScenarioIds', () => {
  const os = require('os');
  const path = require('path');
  // Store temporário por processo: o store real (qa/qa-waves/scenario-store.json)
  // é compartilhado e sofre corrida entre workers paralelos do Jest — o serviço
  // já suporta override via QA_WAVES_SCENARIO_STORE_PATH exatamente para isso.
  const TMP_STORE = path.join(os.tmpdir(), `qa-waves-scenario-store-test-${process.pid}.json`);

  beforeEach(() => {
    process.env.QA_WAVES_SCENARIO_STORE_PATH = TMP_STORE;
    jest.resetModules();
    const realFs = jest.requireActual('fs');
    if (realFs.existsSync(TMP_STORE)) realFs.unlinkSync(TMP_STORE);
  });

  afterEach(() => {
    delete process.env.QA_WAVES_SCENARIO_STORE_PATH;
    const realFs = jest.requireActual('fs');
    if (realFs.existsSync(TMP_STORE)) realFs.unlinkSync(TMP_STORE);
  });

  function loadServiceWithRegistry(registry) {
    jest.doMock('fs', () => {
      const real = jest.requireActual('fs');
      return {
        ...real,
        readFileSync: (p, ...args) => {
          if (String(p).endsWith('qa-mesh/meshRegistry.json')) return JSON.stringify(registry);
          return real.readFileSync(p, ...args);
        },
      };
    });
    // eslint-disable-next-line global-require
    return require('../../api/services/qaWavesScenarioService');
  }

  test('runScenarioExecution propaga PIPELINE_ONLY_SCENARIO para cenário pipeline-only existente', () => {
    const registryEntry = { id: 'biz-pipeline-only', requiresOfficialPipeline: true };
    const svc = loadServiceWithRegistry([registryEntry]);
    // injeta cenário no store via upsert
    svc.upsertScenarioStore({
      id: 'demo-pipeline-only',
      waveId: 'wave-qa',
      journeyId: 'demo',
      vertical: 'beauty',
      source: 'catalog',
      risk: 'high',
      priority: 'high',
      channels: ['whatsapp'],
      status: 'approved',
      platformScenarioIds: ['biz-pipeline-only'],
      validations: { requireReplay: true },
      steps: [
        {
          id: 'step_1',
          order: 1,
          type: 'validate_backend',
          category: 'VALIDATION',
          actor: 'system',
          name: 'valida backend',
          adapter: 'api',
          expected: { backendEntity: 'campaign', campaignCreated: true },
          enabled: true,
        },
      ],
      seeds: [],
    });
    try {
      svc.runScenarioExecution({ mode: 'real', scenarioIds: ['demo-pipeline-only'] });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe('PIPELINE_ONLY_SCENARIO');
      expect(err.message).toContain('pipeline oficial');
    } finally {
      svc.deleteScenario('demo-pipeline-only');
    }
  });

  test('mantém MISSING_PLATFORM_SCENARIO_IDS quando nada é declarado', () => {
    const svc = loadServiceWithRegistry([]);
    svc.upsertScenarioStore({
      id: 'demo-sem-ids',
      waveId: 'wave-qa',
      journeyId: 'demo',
      vertical: 'beauty',
      source: 'catalog',
      risk: 'high',
      priority: 'high',
      channels: ['whatsapp'],
      status: 'approved',
      platformScenarioIds: [],
      validations: { requireReplay: true },
      steps: [
        {
          id: 'step_1',
          order: 1,
          type: 'validate_backend',
          category: 'VALIDATION',
          actor: 'system',
          name: 'valida backend',
          adapter: 'api',
          expected: { backendEntity: 'campaign', campaignCreated: true },
          enabled: true,
        },
      ],
      seeds: [],
    });
    try {
      svc.runScenarioExecution({ mode: 'real', scenarioIds: ['demo-sem-ids'] });
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err.code).toBe('MISSING_PLATFORM_SCENARIO_IDS');
    } finally {
      svc.deleteScenario('demo-sem-ids');
    }
  });
});

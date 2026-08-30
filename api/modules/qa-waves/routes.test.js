'use strict';

const express = require('express');
const http = require('http');
const { createQaWavesRoutes } = require('./routes');

function request(port, method, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);

    const headers = {
      ...(payload != null
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {}),
      ...(extraHeaders || {}),
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function createDefaultDeps() {
  return {
    // Autentica como super_admin (classificação DEVELOPMENT): QA Waves é ferramenta
    // de engenharia restrita a DEVELOPMENT após a política de segregação.
    requireAuth: jest.fn((req) => {
      req.agent = { id: 'agent-root', username: 'systemadmin', role: 'super_admin', tenantId: 'system' };
      return { valid: true, agent: req.agent };
    }),
    requirePermission: jest.fn(() => ({ allowed: true })),
    sendJson: (res, status, payload) => res.status(status).json(payload),
    badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { error: jest.fn() },
    listWaves: jest.fn(() => []),
    getWaveCoverageSummary: jest.fn(() => ({
      generatedAt: '2026-07-25T00:00:00.000Z',
      totalItems: 6,
      visitedCoverage: 33.3,
      validatedCoverage: 16.7,
      successRate: 100,
      weightedCoverage: 38.5,
      dimensionCoverage: { alpha: { total: 1, eligible: 1, visited: 100, validated: 100, weighted: 100 } },
      criticalSummary: { uncovered: 1, failed: 0, stale: 0, orphaned: 0 },
    })),
    listJourneys: jest.fn(() => ({ domains: [{ id: 'fitness', name: 'Fitness', journeys: [] }] })),
    listJourneyStatus: jest.fn(() => ({ items: [{ journeyId: 'fitness_new_customer', status: 'GO' }] })),
    listStepStatus: jest.fn(() => ({ items: [{ stepId: 'step_01_discovery', status: 'GO' }] })),
    listReplays: jest.fn(() => ({ items: [], page: 1, pageSize: 10, total: 0 })),
    getReplayById: jest.fn(() => null),
    queueWaveExecution: jest.fn(() => ({ executionId: 'exec-1' })),
    reexecuteReplay: jest.fn(() => ({ executionId: 'replay-1' })),
    inferWaveScenario: jest.fn((payload) => ({
      scenario: { id: payload.goal ? 'scenario-from-goal' : 'scenario-1' },
      validation: { valid: true, errors: [], warnings: [] },
    })),
    generateWaveSeeds: jest.fn(() => ({ seeds: [{ id: 'seed_1' }] })),
    validateWaveScenario: jest.fn(() => ({
      valid: true,
      errors: [],
      warnings: [],
      normalizedScenario: { id: 'scenario-1' },
    })),
    saveWaveScenario: jest.fn(() => ({ scenario: { id: 'scenario-1', version: 'v2' } })),
    listWaveScenarios: jest.fn(() => ({ items: [{ id: 'scenario-1', version: 'v1' }], history: {} })),
    runWaveScenario: jest.fn(() => ({ executionId: 'mesh-1', replayId: 'replay-1' })),
    reviewVertical: jest.fn(() => ({ reviewId: 'vr-1', recordedJourney: null })),
    reviewJourneyInfer: jest.fn(() => ({ inferredScenario: { id: 'scenario-1' } })),
    reviewJourneyApply: jest.fn(() => ({ scenario: { id: 'scenario-1', status: 'approved' } })),
    getWaveExecutionHistory: jest.fn(() => ({
      items: [{ executionId: 'exec-hist-1', goNoGo: 'GO' }],
      verification: { valid: true, brokenAt: null },
      chainPath: '/tmp/chain.jsonl',
    })),
    getOperationalSnapshot: jest.fn(() => ({
      summary: { goNoGo: 'NO_GO', capabilities: 3, journeys: 1 },
      governance: { goNoGo: 'NO_GO', blockers: [{ capability: 'turnstile_release', reason: 'capability_sem_replay' }] },
      coverage: {},
      gaps: { implementation: [], e2e: [], replay: [], ux: [], operational: [] },
      autoGeneration: [],
    })),
    buildOperationalSnapshot: jest.fn(() => ({
      summary: { goNoGo: 'NO_GO', capabilities: 3, journeys: 1 },
      governance: { goNoGo: 'NO_GO', blockers: [] },
      coverage: {},
      gaps: { implementation: [], e2e: [], replay: [], ux: [], operational: [] },
      autoGeneration: [],
    })),
    listWaveGovernanceReports: jest.fn(() => []),
    evaluateWaveGovernance: jest.fn(() => ({ status: 'NO_GO', reasons: ['legacy_policy'] })),
    // Auto-Generation Bot deps
    executeScenarioGeneration: jest.fn(() => ({
      status: 'success',
      generatedCount: 1,
      scenarios: [{ id: 'generated-scenario-1' }],
      persisted: true,
    })),
    executeUIStepGeneration: jest.fn(() => ({
      status: 'success',
      generatedCount: 5,
      coverage: 0.8,
      steps: [{ capability: 'support_ticket_flow', steps: [] }],
    })),
    executeValidatorGeneration: jest.fn(() => ({
      status: 'success',
      generatedCount: 3,
      byType: { data_persisted: 2, state_changed: 1 },
    })),
    executeSeedGeneration: jest.fn(() => ({
      status: 'success',
      generatedCount: 12,
      byPath: { happy_path: 3, edge_cases: 4, failure: 5 },
    })),
    validatePreflightForCapabilities: jest.fn(() => ({
      status: 'success',
      validated: 2,
      passed: 1,
      failed: 1,
    })),
    executeAutonomousGapClosureLoop: jest.fn(() => ({
      status: 'completed',
      governance: { goNoGo: 'GO', blockers: [] },
    })),
    buildStagingAutonomousLoopPayload: jest.fn(() => ({
      waveId: 'wave-staging-smoke-fixed',
      journeyId: 'support_ticket_flow',
      scenarioIds: ['staging-smoke-scenario-1'],
      capabilityIds: ['support_ticket_flow'],
      tenantId: 'system',
      context: { tenantId: 'system', integrations: {} },
    })),
    runIntegrationReadinessProbe: jest.fn(async () => ({
      readinessAt: '2026-05-07T00:00:00.000Z',
      goNoGo: 'GO',
      allReady: true,
      notReady: [],
      integrations: {
        crm: { ok: true, evidence: { contactsDetected: 2 } },
        payment_gateway: { ok: true, evidence: { provider: 'sandbox' } },
        pbx: { ok: true, evidence: { tenantConfigured: true } },
        release_mechanism: { ok: false, reason: 'device_id_missing' },
      },
    })),
    executeFullGenerationBot: jest.fn(() => ({
      status: 'success',
      duration: 1234,
      steps: {
        scenarios: { status: 'success', count: 1 },
        uiSteps: { status: 'success', count: 5 },
        validators: { status: 'success', count: 3 },
        seeds: { status: 'success', count: 12 },
        preflight: { status: 'success', count: 2 },
      },
      summary: {
        scenariosGenerated: 1,
        uiStepsGenerated: 5,
        validatorsGenerated: 3,
        seedsGenerated: 12,
        preflightValidated: 2,
      },
      persisted: true,
    })),
    applyAutoRemediations: jest.fn(() => ({
      status: 'success',
      appliedCount: 3,
      results: [
        { type: 'scenario_generation', status: 'success' },
        { type: 'validator_generation', status: 'success' },
        { type: 'seed_generation', status: 'success' },
      ],
    })),
  };
}

describe('qa-waves routes', () => {
  let server;
  let port;
  let deps;

  async function startWithDeps(customize) {
    deps = createDefaultDeps();
    if (typeof customize === 'function') customize(deps);

    const app = express();
    app.use(createQaWavesRoutes({ buildDeps: () => deps }));

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });
  }

  async function stopServer() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    port = 0;
  }

  afterEach(async () => {
    await stopServer();
  });

  test('GET /api/qa-waves/journeys deve retornar 401 sem autenticacao', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockReturnValue({ valid: false, error: 'token_missing' });
    });

    const res = await request(port, 'GET', '/api/qa-waves/journeys');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', message: 'token_missing' });
  });

  test('GET /api/qa-waves/waves deve retornar 403 classification_required para operator', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockImplementation((req) => {
        req.agent = { id: 'agent-op', username: 'operador', role: 'operator', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/waves');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
    });
    expect(deps.listWaves).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/waves deve retornar 403 classification_required para auditor de tenant puro (PRODUCTION < DEVELOPMENT)', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockImplementation((req) => {
        req.agent = { id: 'agent-aud', username: 'auditor', role: 'auditor', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/waves');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
    });
    expect(deps.listWaves).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/waves deve retornar 403 classification_required para auditor com platformRole support (SUPPORT < DEVELOPMENT)', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockImplementation((req) => {
        req.agent = { id: 'agent-aud', username: 'auditor', role: 'auditor', platformRole: 'support_n2', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/waves');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'SUPPORT',
    });
    expect(deps.listWaves).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/executions/history deve retornar 401 sem autenticacao', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockReturnValue({ valid: false, error: 'token_missing' });
    });

    const res = await request(port, 'GET', '/api/qa-waves/executions/history');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', message: 'token_missing' });
    expect(deps.getWaveExecutionHistory).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/executions/history deve retornar 403 classification_required para operator', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockImplementation((req) => {
        req.agent = { id: 'agent-op', username: 'operador', role: 'operator', tenantId: 'tenant-x' };
        return { valid: true, agent: req.agent };
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/executions/history');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
    });
    expect(deps.getWaveExecutionHistory).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/executions/history retorna cadeia imutável e verificação para DEVELOPMENT', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/executions/history?limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [{ executionId: 'exec-hist-1', goNoGo: 'GO' }],
      verification: { valid: true, brokenAt: null },
      chainPath: '/tmp/chain.jsonl',
    });
    expect(deps.getWaveExecutionHistory).toHaveBeenCalledWith(10, 'system');
  });

  test('GET /api/qa-waves/executions/history não colide com /executions/:executionId', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/executions/history');

    expect(res.status).toBe(200);
    expect(deps.getWaveExecutionHistory).toHaveBeenCalled();
  });

  test('GET /api/qa-waves/coverage/summary deve retornar consolidado de cobertura para super_admin', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/coverage/summary');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('visitedCoverage');
    expect(res.body).toHaveProperty('validatedCoverage');
    expect(res.body).toHaveProperty('successRate');
    expect(res.body).toHaveProperty('weightedCoverage');
    expect(res.body).toHaveProperty('dimensionCoverage');
    expect(res.body).toHaveProperty('criticalSummary');
    expect(deps.getWaveCoverageSummary).toHaveBeenCalledTimes(1);
  });

  test('GET /api/qa-waves/coverage/summary deve retornar 401 sem autenticacao', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockReturnValue({ valid: false, error: 'token_missing' });
    });

    const res = await request(port, 'GET', '/api/qa-waves/coverage/summary');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized', message: 'token_missing' });
    expect(deps.getWaveCoverageSummary).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/journeys deve retornar payload de jornadas', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/journeys');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('domains');
    expect(deps.listJourneys).toHaveBeenCalledTimes(1);
  });

  test('GET /api/qa-waves/journey-status deve retornar status agregado', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/journey-status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ journeyId: 'fitness_new_customer', status: 'GO' }] });
    expect(deps.listJourneyStatus).toHaveBeenCalledTimes(1);
  });

  test('GET /api/qa-waves/step-status deve encaminhar filtro de journeyId', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/step-status?journeyId=fitness_new_customer');

    expect(res.status).toBe(200);
    expect(deps.listStepStatus).toHaveBeenCalledWith(
      expect.objectContaining({ journeyId: 'fitness_new_customer' })
    );
  });

  test('GET /api/qa-waves/journey-status deve retornar 500 quando houver excecao', async () => {
    await startWithDeps((d) => {
      d.listJourneyStatus.mockImplementation(() => {
        throw new Error('boom');
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/journey-status');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error', message: 'Erro ao listar status de jornada' });
    expect(deps.logger.error).toHaveBeenCalled();
  });

  test('GET /api/qa-waves/scenarios deve retornar cenarios versionados', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/scenarios?waveId=fitness-cliente-novo');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(deps.listWaveScenarios).toHaveBeenCalledWith(
      expect.objectContaining({ waveId: 'fitness-cliente-novo' })
    );
  });

  test('POST /dev/qa-waves/infer-scenario deve inferir cenario semantico', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        vertical: 'fitness',
        journey: 'cliente_novo',
        goal: 'aula experimental',
      });
    });

    const res = await request(port, 'POST', '/dev/qa-waves/infer-scenario', {
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scenario');
    expect(deps.inferWaveScenario).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/infer-scenario retorna 503 quando IA esta indisponivel', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({ vertical: 'fitness', goal: 'aula' });
      const aiError = new Error('provider unavailable');
      aiError.code = 'AI_UNAVAILABLE';
      d.inferWaveScenario.mockRejectedValue(aiError);
    });

    const res = await request(port, 'POST', '/api/qa-waves/infer-scenario', {
      vertical: 'fitness',
      goal: 'aula',
    });

    expect(res.status).toBe(503);
    expect(res.body).toEqual(
      expect.objectContaining({ error: 'ai_unavailable' })
    );
  });

  test('POST /api/qa-waves/infer-scenario encaminha tenantId default e permite jornada automatica', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        vertical: 'fitness',
        goal: 'aula experimental',
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/infer-scenario', {
      vertical: 'fitness',
      goal: 'aula experimental',
    });

    expect(res.status).toBe(200);
    expect(deps.inferWaveScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        vertical: 'fitness',
        goal: 'aula experimental',
        tenantId: 'system',
      })
    );
  });

  test('POST /api/qa-waves/validate-scenario deve normalizar e validar', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({ scenario: { id: 'scenario-1' } });
    });

    const res = await request(port, 'POST', '/api/qa-waves/validate-scenario', {
      scenario: { id: 'scenario-1' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      valid: true,
      errors: [],
      warnings: [],
      normalizedScenario: { id: 'scenario-1' },
    });
    expect(deps.validateWaveScenario).toHaveBeenCalled();
  });

  test('POST /dev/qa-waves/run deve executar em modo real e retornar executionId/replayId', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        waveId: 'fitness-cliente-novo',
        scenarioIds: ['fitness_trial_class'],
        mode: 'real',
        replay: true,
      });
    });

    const res = await request(port, 'POST', '/dev/qa-waves/run', {
      waveId: 'fitness-cliente-novo',
      scenarioIds: ['fitness_trial_class'],
      mode: 'real',
      replay: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ executionId: 'mesh-1', replayId: 'replay-1' });
    expect(deps.runWaveScenario).toHaveBeenCalled();
  });

  test('vertical review usa tenant do principal e não o tenant enviado no body', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({ vertical: 'fitness', tenantId: 'tenant-injetado' });
    });

    const res = await request(port, 'POST', '/api/qa-waves/vertical-review', {
      vertical: 'fitness',
      tenantId: 'tenant-injetado',
    });

    expect(res.status).toBe(200);
    expect(deps.reviewVertical).toHaveBeenCalledWith(expect.objectContaining({
      vertical: 'fitness',
      tenantId: 'system',
    }));
  });

  test('execução ignora tenant enviado no body e vincula a fila ao principal', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        scenarioIds: ['scenario-1'],
        tenantId: 'tenant-injetado',
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/executions', {
      scenarioIds: ['scenario-1'],
      tenantId: 'tenant-injetado',
    });

    expect(res.status).toBe(202);
    expect(deps.queueWaveExecution).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-injetado' }),
      'system',
    );
  });

  test('apply de jornada usa tenant e ator autenticados, ignorando campos forjados', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        scenario: { id: 'scenario-1' },
        reviewToken: 'signed-token',
        approved: true,
        tenantId: 'tenant-injetado',
        changedBy: 'attacker',
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/review-journey/apply', {});

    expect(res.status).toBe(200);
    expect(deps.reviewJourneyApply).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'system',
      changedBy: 'agent-root',
      reviewToken: 'signed-token',
      approved: true,
    }));
  });

  test('inferência de jornada vincula o token ao revisor autenticado', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        vertical: 'fitness',
        journeyId: 'cliente_novo',
        tenantId: 'tenant-injetado',
        reviewedBy: 'attacker',
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/review-journey/infer', {});

    expect(res.status).toBe(200);
    expect(deps.reviewJourneyInfer).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'system',
      reviewedBy: 'agent-root',
    }));
  });

  test('docs rejeita path traversal antes de ler arquivo fora da raiz permitida', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/docs/roteiros?name=..%2F..%2F.env');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad_request', message: 'Nome de documento inválido' });
  });

  test('GET /api/qa-waves/operational/summary deve retornar snapshot operacional', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/operational/summary');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(deps.getOperationalSnapshot).toHaveBeenCalledTimes(1);
  });

  test('governança operacional global rejeita super_admin fora do tenant system', async () => {
    await startWithDeps((d) => {
      d.requireAuth.mockImplementation((req) => {
        req.agent = {
          id: 'agent-tenant-a',
          username: 'admin-a',
          role: 'super_admin',
          tenantId: 'tenant-a',
        };
        return { valid: true, agent: req.agent };
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/operational/summary');

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: 'system_tenant_required' }));
    expect(deps.getOperationalSnapshot).not.toHaveBeenCalled();
  });

  test('GET /api/qa-waves/operational/gaps deve retornar gaps consolidados', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/operational/gaps');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        summary: expect.any(Object),
        governance: expect.any(Object),
        coverage: expect.any(Object),
        gaps: expect.any(Object),
      })
    );
  });

  test('POST /api/qa-waves/operational/recompute deve recomputar snapshot', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({ persist: true });
    });

    const res = await request(port, 'POST', '/api/qa-waves/operational/recompute', { persist: true });

    expect(res.status).toBe(200);
    expect(deps.buildOperationalSnapshot).toHaveBeenCalledWith({ persist: true, policy: {} });
  });

  test('POST /api/qa-waves/governance/evaluate deve retornar decisao consolidada operacional', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({ waveId: 'support-agent-operations-wave' });
      d.listWaveScenarios.mockReturnValue({ items: [{ id: 'support-agent-open-ticket-flow' }] });
      d.evaluateWaveGovernance.mockReturnValue({ status: 'NO_GO', reasons: ['legacy_policy'] });
      d.buildOperationalSnapshot.mockReturnValue({
        summary: { goNoGo: 'NO_GO' },
        governance: { goNoGo: 'NO_GO', blockers: [{ capability: 'support_ticket_flow', reason: 'capability_sem_replay' }] },
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/governance/evaluate', {
      waveId: 'support-agent-operations-wave',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        decision: 'NO_GO',
        governance: expect.any(Object),
        operationalGovernance: expect.any(Object),
      })
    );
  });

  // ===== AUTO-GENERATION BOT TESTS =====

  test('POST /api/qa-waves/bot/generate-scenarios deve gerar cenarios', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'support_ticket_flow', name: 'Support Ticket Flow' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/generate-scenarios', {
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        generatedCount: 1,
        scenarios: expect.any(Array),
        persisted: true,
      })
    );
    expect(deps.executeScenarioGeneration).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/generate-ui-steps deve gerar passos de UI', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'fitness_checkin' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/generate-ui-steps', {
      capabilities: [{ id: 'fitness_checkin' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        generatedCount: 5,
      })
    );
    expect(deps.executeUIStepGeneration).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/generate-validators deve gerar validadores', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'support_ticket_flow' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/generate-validators', {
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        generatedCount: 3,
      })
    );
    expect(deps.executeValidatorGeneration).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/generate-seeds deve gerar dados de teste', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'support_ticket_flow' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/generate-seeds', {
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        generatedCount: 12,
      })
    );
    expect(deps.executeSeedGeneration).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/validate-preflight deve validar precondicions', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'support_ticket_flow', journey: 'support_ticket' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/validate-preflight', {
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        validated: 2,
      })
    );
    expect(deps.validatePreflightForCapabilities).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/execute-full-generation deve executar bot completo', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        capabilities: [{ id: 'support_ticket_flow' }],
        generateScenarios: true,
        generateUISteps: true,
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/execute-full-generation', {
      capabilities: [{ id: 'support_ticket_flow' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        duration: expect.any(Number),
        steps: expect.any(Object),
        summary: expect.any(Object),
        persisted: true,
      })
    );
    expect(deps.executeFullGenerationBot).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: expect.any(Array),
        generateScenarios: expect.any(Boolean),
      })
    );
  });

  test('POST /api/qa-waves/bot/apply-remediations deve aplicar remediações', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        remediations: [{ type: 'scenario_generation', capabilityId: 'support_ticket_flow' }],
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/apply-remediations', {
      remediations: [{ type: 'scenario_generation' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'success',
        appliedCount: expect.any(Number),
        results: expect.any(Array),
      })
    );
    expect(deps.applyAutoRemediations).toHaveBeenCalled();
  });

  test('POST /api/qa-waves/bot/generate-scenarios retorna 400 sem capabilities', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({});
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/generate-scenarios', {});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'bad_request',
        message: expect.stringContaining('capabilities'),
      })
    );
  });

  test('GET /api/qa-waves/closure/autonomous-loop/smoke-payload ignora tenant da query e usa o principal', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/closure/autonomous-loop/smoke-payload?tenantId=tenant-a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ready',
        mode: 'staging_smoke',
        payload: expect.any(Object),
      })
    );
    expect(res.body).not.toHaveProperty('readiness');
    expect(deps.buildStagingAutonomousLoopPayload).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'system' })
    );
  });

  test('GET smoke-payload?probe=true deve incluir diagnostico de readiness por integracao', async () => {
    await startWithDeps();

    const res = await request(port, 'GET', '/api/qa-waves/closure/autonomous-loop/smoke-payload?probe=true&tenantId=tenant-a');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        mode: 'staging_smoke',
        readiness: expect.objectContaining({
          goNoGo: expect.stringMatching(/^(GO|NO_GO)$/),
          allReady: expect.any(Boolean),
          notReady: expect.any(Array),
          integrations: expect.any(Object),
        }),
        payload: expect.any(Object),
      })
    );
    expect(deps.runIntegrationReadinessProbe).toHaveBeenCalledTimes(1);
  });

  test('GET smoke-payload?probe=true com NOT_GO reporta status not_ready', async () => {
    await startWithDeps((d) => {
      d.runIntegrationReadinessProbe.mockResolvedValue({
        readinessAt: '2026-05-07T00:00:00.000Z',
        goNoGo: 'NO_GO',
        allReady: false,
        notReady: [{ integration: 'release_mechanism', reason: 'device_id_missing' }],
        integrations: {
          crm: { ok: true },
          payment_gateway: { ok: true },
          pbx: { ok: true },
          release_mechanism: { ok: false, reason: 'device_id_missing' },
        },
      });
    });

    const res = await request(port, 'GET', '/api/qa-waves/closure/autonomous-loop/smoke-payload?probe=true');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.readiness.goNoGo).toBe('NO_GO');
    expect(res.body.readiness.notReady).toHaveLength(1);
    expect(res.body.readiness.notReady[0].integration).toBe('release_mechanism');
  });

  test('POST /api/qa-waves/closure/autonomous-loop/smoke-run deve executar loop com payload smoke', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({
        waveId: 'wave-custom',
        context: { ticketId: 'ticket-123' },
      });
      d.buildStagingAutonomousLoopPayload.mockReturnValue({
        waveId: 'wave-staging-smoke-fixed',
        journeyId: 'support_ticket_flow',
        scenarioIds: ['staging-smoke-scenario-1'],
        capabilityIds: ['support_ticket_flow'],
        tenantId: 'system',
        context: { tenantId: 'system', integrations: { crm: { health: jest.fn() } } },
      });
    });

    const res = await request(port, 'POST', '/api/qa-waves/closure/autonomous-loop/smoke-run', {
      waveId: 'wave-custom',
      context: { ticketId: 'ticket-123' },
    });

    expect(res.status).toBe(200);
    expect(deps.executeAutonomousGapClosureLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        waveId: 'wave-custom',
        context: expect.objectContaining({
          tenantId: 'system',
          ticketId: 'ticket-123',
          integrations: expect.any(Object),
        }),
      })
    );
  });

  test('POST /api/qa-waves/bot/apply-remediations retorna 400 sem remediations', async () => {
    await startWithDeps((d) => {
      d.parseJsonBody.mockResolvedValue({});
    });

    const res = await request(port, 'POST', '/api/qa-waves/bot/apply-remediations', {});

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'bad_request',
        message: expect.stringContaining('remediations'),
      })
    );
  });
});

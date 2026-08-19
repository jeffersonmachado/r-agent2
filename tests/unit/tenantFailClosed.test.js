'use strict';

/**
 * W1-A — Tenant/principal fail-closed.
 *
 * Regressão do hardening que eliminou fallbacks silenciosos de tenant
 * (`|| 'system'`, `|| 'default'`) nos módulos HTTP e na fila de execução:
 *
 * (a) rota do learning-core autenticada mas sem tenant → 400 tenant_required,
 *     sem chamar o service;
 * (b) services de vertical-templates/journey-registry sem tenantId → throw
 *     com code TENANT_REQUIRED (o boundary HTTP garante o tenant);
 * (c) executionQueueService: job sem tenant falha explicitamente
 *     (last_error='tenant_required') sem dispatch como 'system'.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ── (a) learning-core routes ────────────────────────────────────────────────

const mockGetCompetencies = jest.fn();

jest.mock('../../api/modules/learning-core/service', () => ({
  ingestInteractionBatch: jest.fn(async () => ({ accepted: 0, rejected: 0 })),
}));

jest.mock('../../api/modules/learning-core/competencyService', () => ({
  getCompetencies: (...args) => mockGetCompetencies(...args),
  recomputeCompetencies: jest.fn(async () => ({})),
  getSkillGraphArtifact: jest.fn(() => null),
}));

const { handleLearningCoreRoutes } = require('../../api/modules/learning-core/routes');

function buildRouteCtx({ agent }) {
  const sent = [];
  return {
    ctx: {
      req: { agent, query: {} },
      res: {},
      method: 'GET',
      pathname: '/api/learning/competencies/me',
      deps: {
        requireAuth: jest.fn(() => ({ valid: true })),
        sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
        badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
        hasJsonContentType: jest.fn(() => true),
        parseJsonBody: jest.fn(async () => ({})),
      },
    },
    sent,
  };
}

// ── (b) services agent-os ───────────────────────────────────────────────────

const mockTemplateFindAll = jest.fn(async () => []);
const mockTemplateCreate = jest.fn(async (payload) => payload);
jest.mock('../../api/db/models/VerticalTemplate', () => {
  const factory = () => ({ findAll: mockTemplateFindAll, create: mockTemplateCreate, count: jest.fn(async () => 0) });
  return factory;
});

const mockJourneyFindAll = jest.fn(async () => []);
const mockJourneyCreate = jest.fn(async (payload) => payload);
jest.mock('../../api/db/models/JourneyRegistry', () => {
  const factory = () => ({ findAll: mockJourneyFindAll, create: mockJourneyCreate, count: jest.fn(async () => 0) });
  return factory;
});

const templateService = require('../../api/modules/vertical-templates/service');
const journeyService = require('../../api/modules/journey-registry/service');

// ── (d) agent-orchestrator routes ───────────────────────────────────────────

jest.mock('../../api/modules/agent-registry/service', () => ({}));
jest.mock('../../api/modules/ai-governance/service', () => ({}));

const { handleAgentOrchestratorRoutes } = require('../../api/modules/agent-os/routes/agent-orchestrator');

describe('W1-A tenant fail-closed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCompetencies.mockResolvedValue({ agentId: 'u1', competencies: [], profile: {}, computedAt: null });
  });

  describe('(a) learning-core routes', () => {
    test('request autenticado sem tenant → 400 tenant_required, service não chamado', async () => {
      const { ctx, sent } = buildRouteCtx({ agent: { id: 'u1', username: 'agente1', role: 'operator' } });
      const handled = await handleLearningCoreRoutes(ctx);
      expect(handled).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].code).toBe(400);
      expect(sent[0].data).toEqual({ error: 'tenant_required' });
      expect(mockGetCompetencies).not.toHaveBeenCalled();
    });

    test('request autenticado sem req.tenantId mas com agent.tenantId → usa o tenant do agente', async () => {
      const { ctx, sent } = buildRouteCtx({ agent: { id: 'u1', username: 'agente1', role: 'operator', tenantId: 'acme' } });
      const handled = await handleLearningCoreRoutes(ctx);
      expect(handled).toBe(true);
      expect(mockGetCompetencies).toHaveBeenCalledWith({ tenantId: 'acme', agentId: 'u1' });
      expect(sent[0].code).toBe(200);
    });
  });

  describe('(b) services agent-os', () => {
    test('vertical-templates sem tenantId → TENANT_REQUIRED (list e create)', async () => {
      await expect(templateService.listTemplates({ tenantId: null })).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      await expect(templateService.listTemplates({})).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      await expect(templateService.createTemplate({ name: 'X', slug: 'x', category: 'Retail' }))
        .rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      expect(mockTemplateFindAll).not.toHaveBeenCalled();
      expect(mockTemplateCreate).not.toHaveBeenCalled();
    });

    test('vertical-templates com tenantId explícito persiste no tenant correto', async () => {
      await templateService.listTemplates({ tenantId: 'acme' });
      expect(mockTemplateFindAll).toHaveBeenCalledTimes(1);
      expect(mockTemplateFindAll.mock.calls[0][0].where.tenant_id).toBe('acme');

      await templateService.createTemplate({ tenantId: 'acme', name: 'X', slug: 'x', category: 'Retail' });
      expect(mockTemplateCreate).toHaveBeenCalledTimes(1);
      expect(mockTemplateCreate.mock.calls[0][0].tenant_id).toBe('acme');
    });

    test('journey-registry sem tenantId → TENANT_REQUIRED (list e create)', async () => {
      await expect(journeyService.listJourneys({ tenantId: undefined })).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      await expect(journeyService.createJourney({ domain: 'sales', name: 'X', slug: 'x' }))
        .rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
      expect(mockJourneyFindAll).not.toHaveBeenCalled();
      expect(mockJourneyCreate).not.toHaveBeenCalled();
    });

    test('journey-registry com tenantId explícito persiste no tenant correto', async () => {
      await journeyService.createJourney({ tenantId: 'acme', domain: 'sales', name: 'X', slug: 'x' });
      expect(mockJourneyCreate).toHaveBeenCalledTimes(1);
      expect(mockJourneyCreate.mock.calls[0][0].tenant_id).toBe('acme');
    });
  });

  describe('(c) executionQueueService — job sem tenant', () => {
    const mockRunScheduledCycle = jest.fn(async () => ({}));

    function setupQueue({ job }) {
      jest.resetModules();
      const queryCalls = [];
      const sequelizeQuery = jest.fn(async (sql, opts) => {
        queryCalls.push({ sql: String(sql), replacements: (opts && opts.replacements) || {} });
        const s = String(sql);
        if (s.includes('FOR UPDATE SKIP LOCKED')) {
          // Entrega o job uma única vez; depois a fila fica vazia.
          const rows = setupQueue._claimed ? [] : [job];
          setupQueue._claimed = true;
          return [rows];
        }
        if (s.trim().startsWith('SELECT id, attempts')) {
          return [[{ id: job.id, attempts: 0, max_attempts: 3 }]];
        }
        return [[]];
      });
      jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({ query: sequelizeQuery })) }));
      jest.doMock('../../api/db/models', () => ({ ExecutionJob: jest.fn(() => ({})) }));
      jest.doMock('../../infra/rate-limit', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }));
      jest.doMock('../../api/modules/learning-core/adaptiveCycleService', () => ({
        runScheduledCycle: (...args) => mockRunScheduledCycle(...args),
      }));
      // eslint-disable-next-line global-require
      const svc = require('../../api/services/executionQueueService');
      return { svc, queryCalls };
    }

    afterEach(() => {
      jest.dontMock('../../api/db/sequelize');
      jest.dontMock('../../api/db/models');
      jest.dontMock('../../infra/rate-limit');
      jest.dontMock('../../api/modules/learning-core/adaptiveCycleService');
    });

    test('job sem tenant falha com tenant_required e não faz dispatch como system', async () => {
      setupQueue._claimed = false;
      const { svc, queryCalls } = setupQueue({
        job: { id: 'job-no-tenant', kind: 'learning_adaptive_cycle', tenant_key: '', payload: {}, attempts: 0, max_attempts: 3 },
      });

      svc.startExecutionQueueWorker({ intervalMs: 200 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      svc.stopExecutionQueueWorker();

      // Sem dispatch do ciclo adaptativo.
      expect(mockRunScheduledCycle).not.toHaveBeenCalled();
      // O job foi finalizado como falha com erro explícito tenant_required.
      const failUpdates = queryCalls.filter((c) => c.sql.includes("status='pending'") && c.replacements.err);
      expect(failUpdates.length).toBeGreaterThan(0);
      expect(failUpdates[0].replacements.err).toBe('tenant_required');
    });

    test('job com tenant executa normalmente no tenant correto', async () => {
      setupQueue._claimed = false;
      const { svc, queryCalls } = setupQueue({
        job: { id: 'job-with-tenant', kind: 'learning_adaptive_cycle', tenant_key: 'acme', payload: {}, attempts: 0, max_attempts: 3 },
      });

      svc.startExecutionQueueWorker({ intervalMs: 200 });
      await new Promise((resolve) => setTimeout(resolve, 600));
      svc.stopExecutionQueueWorker();

      expect(mockRunScheduledCycle).toHaveBeenCalledWith({ tenantId: 'acme' });
      const failUpdates = queryCalls.filter((c) => c.replacements.err === 'tenant_required');
      expect(failUpdates).toHaveLength(0);
    });
  });

  describe('(d) agent-orchestrator routes', () => {
    function buildOrchestratorCtx({ agent, tenantId }) {
      const sent = [];
      return {
        ctx: {
          req: { agent, tenantId, query: {}, headers: {} },
          res: {},
          method: 'POST',
          pathname: '/api/agent-orchestrator/execute',
          deps: {
            requireAuth: jest.fn(() => ({ valid: true })),
            requirePermission: jest.fn(() => ({ allowed: true })),
            sendJson: jest.fn((res, code, data) => sent.push({ code, data })),
            badRequest: jest.fn((res, message) => sent.push({ code: 400, data: { error: message } })),
            hasJsonContentType: jest.fn(() => true),
            parseJsonBody: jest.fn(async () => ({ intent: 'customer_inquiry' })),
          },
        },
        sent,
      };
    }

    test('POST /execute autenticado sem tenant → 400 tenant_required (sem fallback system)', async () => {
      const { ctx, sent } = buildOrchestratorCtx({ agent: { id: 'u1', username: 'agente1', role: 'admin' } });
      const handled = await handleAgentOrchestratorRoutes(ctx);
      expect(handled).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].code).toBe(400);
      expect(sent[0].data).toEqual({ error: 'tenant_required' });
    });
  });
});

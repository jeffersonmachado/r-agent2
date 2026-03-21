'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  listJourneyEvents: jest.fn(async () => []),
  getSubjectTimeline: jest.fn(async () => []),
  emitJourneyEvent: jest.fn(async () => ({ id: 'vje-1', event_type: 'confirmation_sent' })),
}));

jest.mock('../../api/services/vertical/beautyJourneyService', () => ({
  detectNoShow: jest.fn(async () => ({ id: 'vje-ns', event_type: 'no_show_detected' })),
  recordServiceCompleted: jest.fn(async () => ({ id: 'vje-sc', event_type: 'service_completed' })),
  getCustomerSessionBalance: jest.fn(async () => ({ remaining: 3 })),
}));

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  createSessionBundle: jest.fn(async () => ({ id: 'bundle-1', status: 'active' })),
}));

jest.mock('../../api/services/vertical/verticalRecommendationService', () => ({
  beautyNoShowRisk: jest.fn(async () => ({ score: 0.2, action: 'none' })),
  beautyReengagementSuggestion: jest.fn(async () => ({ suggestion: 'none' })),
  beautyUpsellSuggestion: jest.fn(async () => ({ suggestion: 'none' })),
  beautyBestScheduleSuggestion: jest.fn(async () => ({ suggestion: 'none' })),
}));

jest.mock('../../api/services/vertical/verticalMetricsEngine', () => ({
  computeVerticalMetrics: jest.fn(async () => ({ vertical: 'beauty', attendance: {}, membership: {} })),
}));

const { handleBeautyRoutes } = require('../../api/modules/vertical/handleBeautyRoutes');
// Hold references so beforeEach can restore them after resetMocks: true
const { emitJourneyEvent, listJourneyEvents, getSubjectTimeline } = require('../../api/services/vertical/customerJourneyEngine');
const { detectNoShow, recordServiceCompleted, getCustomerSessionBalance } = require('../../api/services/vertical/beautyJourneyService');
const { createSessionBundle } = require('../../api/services/vertical/billingOrchestrationService');
const { beautyNoShowRisk, beautyReengagementSuggestion, beautyUpsellSuggestion, beautyBestScheduleSuggestion } = require('../../api/services/vertical/verticalRecommendationService');
const { computeVerticalMetrics } = require('../../api/services/vertical/verticalMetricsEngine');

function buildCtx(method, pathname, { body = null, headers = {}, tenantId = 'tenant-a', agent = { id: 'agent-1', tenantId: 'tenant-a' } } = {}) {
  const req = {
    method,
    url: `http://localhost${pathname}`,
    agent,
    tenantId,
    headers: { 'content-type': 'application/json', ...headers },
  };

  let bodyParsed = false;
  const res = {
    statusCode: null,
    body: null,
    writeHead: jest.fn((status) => { res.statusCode = status; }),
    end: jest.fn((data) => { res.body = data; }),
    setHeader: jest.fn(),
  };

  const deps = {
    requireAuth: jest.fn(() => ({ valid: true, agent })),
    requireTenant: jest.fn(() => tenantId),
    requirePermission: jest.fn(() => true),
    sendJson: jest.fn((r, status, b) => { r.statusCode = status; r.body = JSON.stringify(b); }),
    badRequest: jest.fn((r, msg) => { r.statusCode = 400; r.body = JSON.stringify({ error: 'bad_request', message: msg }); }),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => body || {}),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    logAction: jest.fn(),
  };

  return { req, res, method, pathname, deps };
}

describe('verticalBeautyRoutes', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    listJourneyEvents.mockResolvedValue([]);
    getSubjectTimeline.mockResolvedValue([]);
    emitJourneyEvent.mockResolvedValue({ id: 'vje-1', event_type: 'confirmation_sent' });
    detectNoShow.mockResolvedValue({ id: 'vje-ns', event_type: 'no_show_detected' });
    recordServiceCompleted.mockResolvedValue({ id: 'vje-sc', event_type: 'service_completed' });
    getCustomerSessionBalance.mockResolvedValue({ remaining: 3 });
    createSessionBundle.mockResolvedValue({ id: 'bundle-1', status: 'active' });
    beautyNoShowRisk.mockResolvedValue({ score: 0.2, action: 'none' });
    beautyReengagementSuggestion.mockResolvedValue({ suggestion: 'none' });
    beautyUpsellSuggestion.mockResolvedValue({ suggestion: 'none' });
    beautyBestScheduleSuggestion.mockResolvedValue({ suggestion: 'none' });
    computeVerticalMetrics.mockResolvedValue({ vertical: 'beauty', attendance: {}, membership: {} });
  });

  describe('GET /api/beauty/journey/:subjectId', () => {
    it('retorna 200 com timeline do subject', async () => {
      const { getSubjectTimeline } = require('../../api/services/vertical/customerJourneyEngine');
      getSubjectTimeline.mockResolvedValueOnce([{ id: 'e1', event_type: 'confirmation_sent' }]);

      const ctx = buildCtx('GET', '/api/beauty/journey/sub-1');
      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.any(Array));
    });

    it('retorna 401 sem auth', async () => {
      const ctx = buildCtx('GET', '/api/beauty/journey/sub-1');
      ctx.deps.requireAuth.mockReturnValueOnce({ valid: false, error: 'unauthorized' });

      const handled = await handleBeautyRoutes(ctx);
      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 401, expect.objectContaining({ error: 'unauthorized' }));
    });
  });

  describe('POST /api/beauty/journey/event', () => {
    it('cria evento com eventType válido', async () => {
      const ctx = buildCtx('POST', '/api/beauty/journey/event', { body: { eventType: 'confirmation_sent', subjectId: 'sub-1' } });
      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 201, expect.objectContaining({ item: expect.objectContaining({ id: 'vje-1' }) }));
    });

    it('retorna 400 sem eventType', async () => {
      const ctx = buildCtx('POST', '/api/beauty/journey/event', { body: {} });
      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.badRequest).toHaveBeenCalledWith(ctx.res, expect.stringContaining('eventType'));
    });
  });

  describe('POST /api/beauty/service-completed', () => {
    it('registra serviço completado', async () => {
      const { recordServiceCompleted } = require('../../api/services/vertical/beautyJourneyService');
      const ctx = buildCtx('POST', '/api/beauty/service-completed', {
        body: { subjectId: 'sub-1', scheduleId: 'sched-1' },
      });

      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      expect(recordServiceCompleted).toHaveBeenCalled();
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 201, expect.any(Object));
    });
  });

  describe('GET /api/beauty/metrics', () => {
    it('retorna KPIs do vertical', async () => {
      const ctx = buildCtx('GET', '/api/beauty/metrics');
      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      const { computeVerticalMetrics } = require('../../api/services/vertical/verticalMetricsEngine');
      expect(computeVerticalMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'beauty' }),
      );
    });
  });

  describe('GET /api/beauty/no-show-risk/:subjectId', () => {
    it('retorna score de risco de no-show', async () => {
      const ctx = buildCtx('GET', '/api/beauty/no-show-risk/sub-1');
      const handled = await handleBeautyRoutes(ctx);

      expect(handled).toBe(true);
      const { beautyNoShowRisk } = require('../../api/services/vertical/verticalRecommendationService');
      expect(beautyNoShowRisk).toHaveBeenCalled();
    });
  });

  describe('rota que não pertence a beauty', () => {
    it('retorna false para /api/fitness/*', async () => {
      const ctx = buildCtx('GET', '/api/fitness/metrics');
      const handled = await handleBeautyRoutes(ctx);
      expect(handled).toBe(false);
    });
  });
});

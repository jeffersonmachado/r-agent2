'use strict';

jest.mock('../../api/services/vertical/fitnessMembershipService', () => ({
  getMembershipDetail: jest.fn(async () => ({ id: 'mem-1', billing_status: 'active', effectiveBillingStatus: 'active', accessAllowed: true })),
  listFitnessMemberships: jest.fn(async () => ({ items: [], total: 0 })),
  startGracePeriod: jest.fn(async () => ({ id: 'mem-1', billing_status: 'grace_period' })),
  processMembershipRenewal: jest.fn(async () => ({ id: 'mem-1', billing_status: 'active' })),
  getMembershipAccessStatus: jest.fn(async () => ({ accessAllowed: true, billingStatus: 'active' })),
  detectChurnRisk: jest.fn(async () => ({ score: 0.2, isChurnRisk: false })),
  updateMembershipDetails: jest.fn(async () => ({ id: 'mem-1' })),
}));

jest.mock('../../api/services/vertical/fitnessAttendanceService', () => ({
  recordCheckIn: jest.fn(async () => ({ id: 'va-1', status: 'open' })),
  recordCheckOut: jest.fn(async () => ({ id: 'va-1', status: 'completed' })),
  getAttendanceHistory: jest.fn(async () => ({ records: [], frequency30d: 0, frequency7d: 0 })),
  listOpenAttendances: jest.fn(async () => []),
}));

jest.mock('../../api/services/vertical/verticalRecommendationService', () => ({
  fitnessChurnRisk: jest.fn(async () => ({ score: 0.2, action: 'none' })),
  fitnessLowFrequencySuggestion: jest.fn(async () => ({ suggestion: 'none' })),
  fitnessBlockFollowUpSuggestion: jest.fn(async () => ({ suggestion: 'none' })),
}));

jest.mock('../../api/services/vertical/verticalMetricsEngine', () => ({
  computeVerticalMetrics: jest.fn(async () => ({ vertical: 'fitness', attendance: {}, membership: {} })),
}));

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  getSubjectTimeline: jest.fn(async () => []),
  emitJourneyEvent: jest.fn(async () => ({ id: 'vje-1' })),
}));

const { handleFitnessRoutes } = require('../../api/modules/vertical/handleFitnessRoutes');
// Hold references so beforeEach can restore them after resetMocks: true
const { getMembershipDetail: mockGetMembershipDetail, listFitnessMemberships: mockListFitnessMemberships, startGracePeriod: mockStartGracePeriod, processMembershipRenewal: mockProcessRenewal, getMembershipAccessStatus: mockGetMembershipAccessStatus, detectChurnRisk: mockDetectChurnRisk, updateMembershipDetails: mockUpdateMembershipDetails } = require('../../api/services/vertical/fitnessMembershipService');
const { recordCheckIn: mockRecordCheckIn, recordCheckOut: mockRecordCheckOut, getAttendanceHistory: mockGetAttendanceHistory, listOpenAttendances: mockListOpenAttendances } = require('../../api/services/vertical/fitnessAttendanceService');
const { fitnessChurnRisk: mockFitnessChurnRisk, fitnessLowFrequencySuggestion: mockFitnessLowFreq, fitnessBlockFollowUpSuggestion: mockFitnessBlockFollowUp } = require('../../api/services/vertical/verticalRecommendationService');
const { computeVerticalMetrics: mockFitnessComputeMetrics } = require('../../api/services/vertical/verticalMetricsEngine');
const { getSubjectTimeline: mockFitnessTimeline, emitJourneyEvent: mockFitnessEmitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');

function buildCtx(method, pathname, { body = null, headers = {}, tenantId = 'tenant-a', agent = { id: 'agent-1', tenantId: 'tenant-a' } } = {}) {
  const req = {
    method,
    url: `http://localhost${pathname}`,
    agent,
    tenantId,
    headers: { 'content-type': 'application/json', ...headers },
  };

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

describe('verticalFitnessRoutes', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    mockGetMembershipDetail.mockResolvedValue({ id: 'mem-1', billing_status: 'active', effectiveBillingStatus: 'active', accessAllowed: true });
    mockListFitnessMemberships.mockResolvedValue({ items: [], total: 0 });
    mockStartGracePeriod.mockResolvedValue({ id: 'mem-1', billing_status: 'grace_period' });
    mockProcessRenewal.mockResolvedValue({ id: 'mem-1', billing_status: 'active' });
    mockGetMembershipAccessStatus.mockResolvedValue({ accessAllowed: true, billingStatus: 'active' });
    mockDetectChurnRisk.mockResolvedValue({ score: 0.2, isChurnRisk: false });
    mockUpdateMembershipDetails.mockResolvedValue({ id: 'mem-1' });
    mockRecordCheckIn.mockResolvedValue({ id: 'va-1', status: 'open' });
    mockRecordCheckOut.mockResolvedValue({ id: 'va-1', status: 'completed' });
    mockGetAttendanceHistory.mockResolvedValue({ items: [], total: 0, frequency30d: 0, frequency7d: 0 });
    mockListOpenAttendances.mockResolvedValue({ items: [], total: 0 });
    mockFitnessChurnRisk.mockResolvedValue({ score: 0.2, action: 'none' });
    mockFitnessLowFreq.mockResolvedValue({ suggestion: 'none' });
    mockFitnessBlockFollowUp.mockResolvedValue({ suggestion: 'none' });
    mockFitnessComputeMetrics.mockResolvedValue({ vertical: 'fitness', attendance: {}, membership: {} });
    mockFitnessTimeline.mockResolvedValue([]);
    mockFitnessEmitJourneyEvent.mockResolvedValue({ id: 'vje-1' });
  });

  describe('GET /api/fitness/subject/:subjectId/attendance', () => {
    it('retorna histórico de assiduidade', async () => {
      const { getAttendanceHistory } = require('../../api/services/vertical/fitnessAttendanceService');
      getAttendanceHistory.mockResolvedValueOnce({ records: [{ id: 'va-1' }], frequency30d: 5, frequency7d: 2 });

      const ctx = buildCtx('GET', '/api/fitness/subject/sub-1/attendance');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ frequency30d: 5 }));
    });
  });

  describe('POST /api/fitness/attendance/check-in', () => {
    it('registra check-in e retorna attendance', async () => {
      const ctx = buildCtx('POST', '/api/fitness/attendance/check-in', {
        body: { subjectId: 'sub-1', membershipId: 'mem-1', deviceId: 'dev-1' },
      });

      const handled = await handleFitnessRoutes(ctx);
      expect(handled).toBe(true);
      const { recordCheckIn } = require('../../api/services/vertical/fitnessAttendanceService');
      expect(recordCheckIn).toHaveBeenCalled();
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 201, expect.objectContaining({ item: expect.objectContaining({ id: 'va-1' }) }));
    });

    it('retorna 400 sem subjectId', async () => {
      const ctx = buildCtx('POST', '/api/fitness/attendance/check-in', { body: {} });
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.badRequest).toHaveBeenCalled();
    });

    it('retorna 401 sem auth', async () => {
      const ctx = buildCtx('POST', '/api/fitness/attendance/check-in', { body: { subjectId: 'sub-1' } });
      ctx.deps.requireAuth.mockReturnValueOnce({ valid: false, error: 'unauthorized' });

      const handled = await handleFitnessRoutes(ctx);
      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 401, expect.objectContaining({ error: 'unauthorized' }));
    });
  });

  describe('POST /api/fitness/attendance/check-out', () => {
    it('registra check-out', async () => {
      const ctx = buildCtx('POST', '/api/fitness/attendance/check-out', { body: { subjectId: 'sub-1' } });
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { recordCheckOut } = require('../../api/services/vertical/fitnessAttendanceService');
      expect(recordCheckOut).toHaveBeenCalled();
    });
  });

  describe('GET /api/fitness/membership/:membershipId', () => {
    it('retorna detalhe da membership', async () => {
      const ctx = buildCtx('GET', '/api/fitness/membership/mem-1');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { getMembershipDetail } = require('../../api/services/vertical/fitnessMembershipService');
      expect(getMembershipDetail).toHaveBeenCalled();
      // route wraps result in { item }
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ item: expect.objectContaining({ id: 'mem-1' }) }));
    });

    it('retorna 404 quando membership não encontrada', async () => {
      const { getMembershipDetail } = require('../../api/services/vertical/fitnessMembershipService');
      getMembershipDetail.mockResolvedValueOnce(null);

      const ctx = buildCtx('GET', '/api/fitness/membership/nao-existe');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      expect(ctx.deps.sendJson).toHaveBeenCalledWith(ctx.res, 404, expect.objectContaining({ error: expect.any(String) }));
    });
  });

  describe('GET /api/fitness/subject/:subjectId/churn-risk', () => {
    it('retorna score de churn risk', async () => {
      const ctx = buildCtx('GET', '/api/fitness/subject/sub-1/churn-risk');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { fitnessChurnRisk } = require('../../api/services/vertical/verticalRecommendationService');
      expect(fitnessChurnRisk).toHaveBeenCalled();
    });
  });

  describe('GET /api/fitness/metrics', () => {
    it('retorna KPIs do vertical fitness', async () => {
      const ctx = buildCtx('GET', '/api/fitness/metrics');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { computeVerticalMetrics } = require('../../api/services/vertical/verticalMetricsEngine');
      expect(computeVerticalMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'fitness' }),
      );
    });
  });

  describe('GET /api/fitness/memberships', () => {
    it('lista memberships do tenant', async () => {
      const ctx = buildCtx('GET', '/api/fitness/memberships');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { listFitnessMemberships } = require('../../api/services/vertical/fitnessMembershipService');
      expect(listFitnessMemberships).toHaveBeenCalled();
    });
  });

  describe('GET /api/fitness/subject/:subjectId/access-status', () => {
    it('retorna status de acesso do subject', async () => {
      const ctx = buildCtx('GET', '/api/fitness/subject/sub-1/access-status');
      const handled = await handleFitnessRoutes(ctx);

      expect(handled).toBe(true);
      const { getMembershipAccessStatus } = require('../../api/services/vertical/fitnessMembershipService');
      expect(getMembershipAccessStatus).toHaveBeenCalled();
    });
  });

  describe('rota que não pertence a fitness', () => {
    it('retorna false para /api/beauty/*', async () => {
      const ctx = buildCtx('GET', '/api/beauty/metrics');
      const handled = await handleFitnessRoutes(ctx);
      expect(handled).toBe(false);
    });
  });
});

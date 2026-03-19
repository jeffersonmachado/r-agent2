'use strict';

jest.mock('../../api/services/vertical/engagementEngine', () => ({
  computeEngagementSignal: jest.fn(async ({ vertical, noShowCount = 0, totalAppointments = 0 }) => {
    const noShowRate = totalAppointments > 0 ? noShowCount / totalAppointments : 0;
    const score = vertical === 'beauty' ? Math.min(noShowRate * 1.5, 1.0) : 0.2;
    return {
      signal_type: score >= 0.7 ? 'churn_risk' : score >= 0.4 ? 'low_frequency' : 'healthy',
      score,
      days_since_last_visit: 5,
      frequency_last_30d: 3,
    };
  }),
  getRecentAttendances: jest.fn(async () => []),
}));

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  getSessionBalance: jest.fn(async () => ({ remaining: 3, total: 10, used: 7 })),
}));

const {
  beautyNoShowRisk,
  beautyReengagementSuggestion,
  beautyUpsellSuggestion,
  fitnessChurnRisk,
  fitnessLowFrequencySuggestion,
  fitnessBlockFollowUpSuggestion,
} = require('../../api/services/vertical/verticalRecommendationService');
const { computeEngagementSignal, getRecentAttendances } = require('../../api/services/vertical/engagementEngine');
const { getSessionBalance } = require('../../api/services/vertical/billingOrchestrationService');

describe('verticalRecommendationService', () => {
  const tenantId = 'tenant-a';
  const subjectId = 'sub-1';
  const membershipId = 'mem-1';

  beforeEach(() => {
    // resetMocks: true wipes all implementations — restore them here
    jest.clearAllMocks();
    computeEngagementSignal.mockImplementation(async ({ vertical, noShowCount = 0, totalAppointments = 0 }) => {
      const noShowRate = totalAppointments > 0 ? noShowCount / totalAppointments : 0;
      const score = vertical === 'beauty' ? Math.min(noShowRate * 1.5, 1.0) : 0.2;
      return {
        signal_type: score >= 0.7 ? 'churn_risk' : score >= 0.4 ? 'low_frequency' : 'healthy',
        score,
        days_since_last_visit: 5,
        frequency_last_30d: 3,
      };
    });
    getSessionBalance.mockResolvedValue({ remaining: 3, total: 10, used: 7 });
    getRecentAttendances.mockResolvedValue([]);
  });

  describe('beautyNoShowRisk', () => {
    it('retorna score e action para alto risco de no-show', async () => {
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'churn_risk',
        score: 0.8,
        days_since_last_visit: 30,
        frequency_last_30d: 0,
      });

      const result = await beautyNoShowRisk({
        tenantId, subjectId, membershipId,
        noShowCount: 3, totalAppointments: 4,
      });

      expect(result.score).toBe(0.8);
      expect(result.action).toBe('send_confirmation_reminder');
      expect(result.vertical).toBe('beauty');
    });

    it('retorna action none para baixo risco', async () => {
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'healthy',
        score: 0.1,
        days_since_last_visit: 3,
        frequency_last_30d: 5,
      });

      const result = await beautyNoShowRisk({
        tenantId, subjectId, membershipId,
        noShowCount: 0, totalAppointments: 10,
      });

      expect(result.action).toBe('none');
    });

    it('sempre retorna evidence com computedBy=heuristic_v1', async () => {
      const result = await beautyNoShowRisk({ tenantId, subjectId, membershipId });
      expect(result.evidence).toMatchObject({ computedBy: 'heuristic_v1' });
    });
  });

  describe('beautyReengagementSuggestion', () => {
    it('sugere campanha de reativação para subject inativo 60+ dias', async () => {
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'inactive',
        score: 0.6,
        days_since_last_visit: 75,
        frequency_last_30d: 0,
      });

      const result = await beautyReengagementSuggestion({ tenantId, subjectId, membershipId });
      expect(result.suggestion).toBe('reactivation_campaign');
    });
  });

  describe('beautyUpsellSuggestion', () => {
    it('sugere upsell de pacote quando sessões estão acabando', async () => {
      const { getSessionBalance } = require('../../api/services/vertical/billingOrchestrationService');
      getSessionBalance.mockResolvedValueOnce({ hasBundle: true, remaining: 1, total: 10, used: 9, bundleId: 'bundle-1', bundleType: 'package' });
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'healthy',
        score: 0.1,
        days_since_last_visit: 3,
        frequency_last_30d: 4,
      });

      const result = await beautyUpsellSuggestion({ tenantId, subjectId, membershipId });
      expect(result.suggestion).toContain('package');
    });
  });

  describe('fitnessChurnRisk', () => {
    it('retorna alto score para subject inativo 45+ dias', async () => {
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'churn_risk',
        score: 0.85,
        days_since_last_visit: 45,
        frequency_last_30d: 0,
      });

      const result = await fitnessChurnRisk({ tenantId, subjectId, membershipId, daysSinceLastVisit: 45, frequency30d: 0 });
      expect(result.score).toBeGreaterThan(0.5);
      expect(result.action).not.toBe('none');
    });
  });

  describe('fitnessLowFrequencySuggestion', () => {
    it('sugere campanha para subject com baixa frequência', async () => {
      const { computeEngagementSignal } = require('../../api/services/vertical/engagementEngine');
      computeEngagementSignal.mockResolvedValueOnce({
        signal_type: 'low_frequency',
        score: 0.5,
        days_since_last_visit: 12,
        frequency_last_30d: 1,
      });

      const result = await fitnessLowFrequencySuggestion({ tenantId, subjectId, membershipId, frequency30d: 1 });
      expect(result.suggestion).toBeDefined();
    });
  });

  describe('fitnessBlockFollowUpSuggestion', () => {
    it('sugere follow-up quando billing_status é blocked', async () => {
      const result = await fitnessBlockFollowUpSuggestion({
        tenantId, subjectId, membershipId, billingStatus: 'blocked', blockCount: 2,
      });
      expect(result.suggestion).toBeDefined();
      expect(result.reason).toBeDefined();
    });
  });
});

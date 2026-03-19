'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('sequelize', () => ({
  Op: { gte: Symbol('gte'), in: Symbol('in') },
}));

jest.mock('../../api/db/models', () => ({
  VerticalAttendance: jest.fn(() => mockVerticalAttendance),
  VerticalJourneyEvent: jest.fn(() => mockVerticalJourneyEvent),
  VerticalSessionBundle: jest.fn(() => mockVerticalSessionBundle),
  VerticalEngagementSignal: jest.fn(() => mockVerticalEngagementSignal),
  AccessMembership: jest.fn(() => mockAccessMembership),
}));

const makeToJson = (obj) => ({ ...obj, toJSON: () => obj });

const mockVerticalAttendance = { findAll: jest.fn() };
const mockVerticalJourneyEvent = { findAll: jest.fn() };
const mockVerticalSessionBundle = { findAll: jest.fn() };
const mockVerticalEngagementSignal = { findAll: jest.fn() };
const mockAccessMembership = { findAll: jest.fn() };

const { computeVerticalMetrics } = require('../../api/services/vertical/verticalMetricsEngine');
const { getSequelize } = require('../../api/db/sequelize');
const {
  VerticalAttendance: mockVerticalAttendanceFactory,
  VerticalJourneyEvent: mockVerticalJourneyEventFactory,
  VerticalSessionBundle: mockVerticalSessionBundleFactory,
  VerticalEngagementSignal: mockVerticalEngagementSignalFactory,
  AccessMembership: mockAccessMembershipFactory,
} = require('../../api/db/models');

describe('verticalMetricsEngine', () => {
  const tenantId = 'tenant-a';

  beforeEach(() => {
    // resetMocks: true wipes all implementations — restore them here
    getSequelize.mockReturnValue({});
    mockVerticalAttendanceFactory.mockReturnValue(mockVerticalAttendance);
    mockVerticalJourneyEventFactory.mockReturnValue(mockVerticalJourneyEvent);
    mockVerticalSessionBundleFactory.mockReturnValue(mockVerticalSessionBundle);
    mockVerticalEngagementSignalFactory.mockReturnValue(mockVerticalEngagementSignal);
    mockAccessMembershipFactory.mockReturnValue(mockAccessMembership);
    mockVerticalAttendance.findAll.mockResolvedValue([]);
    mockVerticalJourneyEvent.findAll.mockResolvedValue([]);
    mockVerticalSessionBundle.findAll.mockResolvedValue([]);
    mockVerticalEngagementSignal.findAll.mockResolvedValue([]);
    mockAccessMembership.findAll.mockResolvedValue([]);
  });

  describe('computeVerticalMetrics', () => {
    it('retorna estrutura de KPIs para fitness', async () => {
      const result = await computeVerticalMetrics({ tenantId, vertical: 'fitness', windowDays: 30 });

      expect(result).toMatchObject({
        tenantId,
        vertical: 'fitness',
        windowDays: 30,
      });
      expect(result.computedAt).toBeDefined();
    });

    it('retorna estrutura de KPIs para beauty', async () => {
      const result = await computeVerticalMetrics({ tenantId, vertical: 'beauty', windowDays: 30 });
      expect(result.vertical).toBe('beauty');
    });

    it('calcula noShowRate corretamente com dados de attendance', async () => {
      const now = new Date();
      mockVerticalAttendance.findAll.mockResolvedValueOnce([
        makeToJson({ id: 'va-1', status: 'completed', subject_id: 'sub-1', checked_in_at: now }),
        makeToJson({ id: 'va-2', status: 'absent', subject_id: 'sub-2', checked_in_at: now }),
        makeToJson({ id: 'va-3', status: 'absent', subject_id: 'sub-3', checked_in_at: now }),
        makeToJson({ id: 'va-4', status: 'completed', subject_id: 'sub-4', checked_in_at: now }),
      ]);

      const result = await computeVerticalMetrics({ tenantId, vertical: 'fitness' });

      expect(result.attendance.noShowRate).toBe(0.5); // 2/4
      expect(result.attendance.total).toBe(4);
      expect(result.attendance.absent).toBe(2);
    });

    it('calcula returnRate para subjects recorrentes', async () => {
      const now = new Date();
      mockVerticalAttendance.findAll.mockResolvedValueOnce([
        makeToJson({ id: 'va-1', status: 'completed', subject_id: 'sub-1', checked_in_at: now }),
        makeToJson({ id: 'va-2', status: 'completed', subject_id: 'sub-1', checked_in_at: now }),
        makeToJson({ id: 'va-3', status: 'completed', subject_id: 'sub-2', checked_in_at: now }),
      ]);

      const result = await computeVerticalMetrics({ tenantId, vertical: 'fitness' });

      // sub-1 é recorrente; sub-2 não. returnRate = 1/2 = 0.5
      expect(result.attendance.returnRate).toBe(0.5);
      expect(result.attendance.uniqueSubjects).toBe(2);
    });

    it('conta KPIs de journey por eventType', async () => {
      mockVerticalJourneyEvent.findAll.mockResolvedValueOnce([
        makeToJson({ event_type: 'confirmation_sent', occurred_at: new Date() }),
        makeToJson({ event_type: 'confirmation_sent', occurred_at: new Date() }),
        makeToJson({ event_type: 'no_show_detected', occurred_at: new Date() }),
        makeToJson({ event_type: 'service_completed', occurred_at: new Date() }),
      ]);

      const result = await computeVerticalMetrics({ tenantId, vertical: 'beauty' });

      expect(result.journey.byEventType.confirmation_sent).toBe(2);
      expect(result.journey.byEventType.no_show_detected).toBe(1);
      expect(result.journey.totalJourneyEvents).toBe(4);
    });

    it('retorna nulls para KPIs quando DB indisponível', async () => {
      const { getSequelize } = require('../../api/db/sequelize');
      getSequelize.mockReturnValue(null);

      const result = await computeVerticalMetrics({ tenantId, vertical: 'fitness' });
      expect(result.attendance).toBeNull();
      expect(result.membership).toBeNull();
    });

    it('usa windowDays padrão de 30 quando não informado', async () => {
      const result = await computeVerticalMetrics({ tenantId, vertical: 'fitness' });
      expect(result.windowDays).toBe(30);
    });
  });
});

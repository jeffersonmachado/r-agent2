'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  NotificationDelivery: jest.fn(),
  VerticalJourneyEvent: jest.fn(),
  VerticalAttendance: jest.fn(),
  VerticalEngagementSignal: jest.fn(),
  AccessMembership: jest.fn(),
  ExecutionJob: jest.fn(),
  EventLedger: jest.fn(),
  BillingTransaction: jest.fn(),
}));

jest.mock('../../api/services/vertical/verticalMetricsEngine', () => ({
  computeVerticalMetrics: jest.fn(async ({ vertical }) => ({ vertical, attendance: {}, membership: {} })),
}));

jest.mock('../../api/services/billingOpsMetricsService', () => ({
  getBillingOpsMetrics: jest.fn(async () => ({
    ok: true,
    metrics: {
      totalTransactions: 0,
      confirmedCount: 0,
      overdueCount: 0,
      cancelledCount: 0,
      refundedCount: 0,
      chargebackCount: 0,
      pendingCount: 0,
      grossConfirmedAmount: 0,
      refundedAmount: 0,
      chargebackAmount: 0,
      netRecoveredAmount: 0,
      byProvider: {},
      byVertical: {},
    },
  })),
}));

jest.mock('../../api/services/vertical/verticalRecommendationService', () => ({
  beautyNoShowRisk: jest.fn(async () => ({ score: 0.8, action: 'send_confirmation_reminder', reason: 'high risk', evidence: { score: 0.8 } })),
  beautyReengagementSuggestion: jest.fn(async () => ({ suggestion: 'reactivation_campaign', reason: 'inactive', evidence: { score: 0.75 } })),
  beautyUpsellSuggestion: jest.fn(async () => ({ suggestion: 'renew_package', reason: 'bundle low', evidence: {} })),
  fitnessChurnRisk: jest.fn(async () => ({ score: 0.7, action: 'immediate_retention_outreach', reason: 'churn risk', evidence: { score: 0.7 } })),
  fitnessLowFrequencySuggestion: jest.fn(async () => ({ suggestion: 'frequency_incentive', reason: 'low frequency', evidence: { score: 0.6 } })),
  fitnessBlockFollowUpSuggestion: jest.fn(() => ({ suggestion: 'automated_payment_reminder', reason: 'delinquent', evidence: { blockCount: 0 } })),
}));

const makeRow = (data) => ({ ...data, toJSON: () => data });

const mockVerticalJourneyEvent = { findAll: jest.fn() };
const mockVerticalAttendance = { findAll: jest.fn() };
const mockVerticalEngagementSignal = { findAll: jest.fn() };
const mockAccessMembership = { findAll: jest.fn() };
const mockExecutionJob = { findAll: jest.fn() };
const mockEventLedger = { findAll: jest.fn(), findOne: jest.fn() };
const mockBillingTransaction = { findAll: jest.fn() };
const mockNotificationDelivery = { findAll: jest.fn() };

const {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
  listFinancialTransactions,
} = require('../../api/services/operationsDashboardService');
const { getSequelize } = require('../../api/db/sequelize');
const { computeVerticalMetrics } = require('../../api/services/vertical/verticalMetricsEngine');
const { getBillingOpsMetrics } = require('../../api/services/billingOpsMetricsService');
const {
  beautyNoShowRisk,
  beautyReengagementSuggestion,
  beautyUpsellSuggestion,
  fitnessChurnRisk,
  fitnessLowFrequencySuggestion,
  fitnessBlockFollowUpSuggestion,
} = require('../../api/services/vertical/verticalRecommendationService');
const {
  VerticalJourneyEvent,
  VerticalAttendance,
  VerticalEngagementSignal,
  AccessMembership,
  ExecutionJob,
  EventLedger,
  BillingTransaction,
  NotificationDelivery,
} = require('../../api/db/models');

describe('operationsDashboardService', () => {
  beforeEach(() => {
    getSequelize.mockReturnValue({});

    computeVerticalMetrics.mockImplementation(async ({ vertical }) => ({ vertical, attendance: {}, membership: {} }));
    getBillingOpsMetrics.mockResolvedValue({
      ok: true,
      metrics: {
        totalTransactions: 0,
        confirmedCount: 0,
        overdueCount: 0,
        cancelledCount: 0,
        refundedCount: 0,
        chargebackCount: 0,
        pendingCount: 0,
        grossConfirmedAmount: 0,
        refundedAmount: 0,
        chargebackAmount: 0,
        netRecoveredAmount: 0,
        byProvider: {},
        byVertical: {},
      },
    });
    beautyNoShowRisk.mockResolvedValue({ score: 0.8, action: 'send_confirmation_reminder', reason: 'high risk', evidence: { score: 0.8 } });
    beautyReengagementSuggestion.mockResolvedValue({ suggestion: 'reactivation_campaign', reason: 'inactive', evidence: { score: 0.75 } });
    beautyUpsellSuggestion.mockResolvedValue({ suggestion: 'renew_package', reason: 'bundle low', evidence: {} });
    fitnessChurnRisk.mockResolvedValue({ score: 0.7, action: 'immediate_retention_outreach', reason: 'churn risk', evidence: { score: 0.7 } });
    fitnessLowFrequencySuggestion.mockResolvedValue({ suggestion: 'frequency_incentive', reason: 'low frequency', evidence: { score: 0.6 } });
    fitnessBlockFollowUpSuggestion.mockImplementation(() => ({ suggestion: 'automated_payment_reminder', reason: 'delinquent', evidence: { blockCount: 0 } }));

    NotificationDelivery.mockReturnValue(mockNotificationDelivery);
    VerticalJourneyEvent.mockReturnValue(mockVerticalJourneyEvent);
    VerticalAttendance.mockReturnValue(mockVerticalAttendance);
    VerticalEngagementSignal.mockReturnValue(mockVerticalEngagementSignal);
    AccessMembership.mockReturnValue(mockAccessMembership);
    ExecutionJob.mockReturnValue(mockExecutionJob);
    EventLedger.mockReturnValue(mockEventLedger);
    BillingTransaction.mockReturnValue(mockBillingTransaction);

    mockVerticalJourneyEvent.findAll.mockResolvedValue([]);
    mockVerticalAttendance.findAll.mockResolvedValue([]);
    mockVerticalEngagementSignal.findAll.mockResolvedValue([]);
    mockAccessMembership.findAll.mockResolvedValue([]);
    mockExecutionJob.findAll.mockResolvedValue([]);
    mockEventLedger.findAll.mockResolvedValue([]);
    mockEventLedger.findOne.mockResolvedValue(null);
    mockBillingTransaction.findAll.mockResolvedValue([]);
    mockNotificationDelivery.findAll.mockResolvedValue([]);
  });

  it('computeSummary agrega dados reais e aplica escopo tenant/período', async () => {
    mockVerticalJourneyEvent.findAll.mockResolvedValueOnce([
      makeRow({ vertical: 'beauty', event_type: 'confirmation_sent', occurred_at: new Date(), channel: 'whatsapp', status: 'emitted', subject_id: 'b1' }),
      makeRow({ vertical: 'beauty', event_type: 'service_completed', occurred_at: new Date(), channel: 'internal', status: 'emitted', subject_id: 'b1' }),
      makeRow({ vertical: 'beauty', event_type: 'no_show_detected', occurred_at: new Date(), channel: 'internal', status: 'emitted', subject_id: 'b2' }),
      makeRow({ vertical: 'beauty', event_type: 'reactivation_sent', occurred_at: new Date(), channel: 'internal', status: 'emitted', subject_id: 'b3' }),
    ]);

    mockVerticalAttendance.findAll.mockResolvedValueOnce([
      makeRow({ vertical: 'fitness', status: 'completed', checked_in_at: new Date(), subject_id: 'f1' }),
      makeRow({ vertical: 'fitness', status: 'completed', checked_in_at: new Date(), subject_id: 'f2' }),
    ]);

    mockVerticalEngagementSignal.findAll.mockResolvedValueOnce([
      makeRow({ subject_id: 'f1', signal_type: 'low_frequency', score: 0.6, computed_at: new Date() }),
    ]);

    mockAccessMembership.findAll.mockResolvedValueOnce([
      makeRow({ id: 'm1', vertical: 'fitness', billing_status: 'active', status: 'active', subject_id: 'f1' }),
      makeRow({ id: 'm2', vertical: 'fitness', billing_status: 'blocked', status: 'active', subject_id: 'f2' }),
    ]);

    mockExecutionJob.findAll.mockResolvedValueOnce([
      makeRow({ id: 'j1', status: 'done', attempts: 0, processing_at: new Date(Date.now() - 1000), updated_at: new Date() }),
      makeRow({ id: 'j2', status: 'dead', attempts: 2, processing_at: new Date(Date.now() - 1200), updated_at: new Date() }),
    ]);

    mockEventLedger.findAll.mockResolvedValueOnce([
      makeRow({ payload: { kind: 'notification_delivery', dashboardStatus: 'sent' }, occurred_at: new Date() }),
      makeRow({ payload: { kind: 'notification_delivery', dashboardStatus: 'failed' }, occurred_at: new Date() }),
    ]);

    const out = await computeSummary({
      tenantId: 'tenant-a',
      vertical: 'all',
      startDate: '2026-03-01',
      endDate: '2026-03-19',
    });

    expect(out.summary.beauty.appointmentsToday).toBe(1);
    expect(out.summary.beauty.completedServices).toBe(1);
    expect(out.summary.beauty.noShow).toBe(1);
    expect(out.summary.beauty.reactivations).toBe(1);

    expect(out.summary.fitness.checkInsToday).toBe(2);
    expect(out.summary.fitness.activeStudents).toBe(1);
    expect(out.summary.fitness.lowFrequency).toBe(1);
    expect(out.summary.fitness.blocked).toBe(1);

    expect(out.summary.system.jobsExecuted).toBe(2);
    expect(out.summary.system.jobsError).toBe(1);
    expect(out.summary.system.notificationsSent).toBe(1);
    expect(out.summary.system.notificationFailures).toBe(1);
    expect(out.summary.system.billing).toEqual(expect.objectContaining({ totalTransactions: 0 }));

    expect(mockVerticalJourneyEvent.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant_key: 'tenant-a' }),
    }));
  });

  it('listTimeline classifica status corretamente (success/failed/pending/provider-dependent)', async () => {
    mockVerticalJourneyEvent.findAll.mockResolvedValueOnce([
      makeRow({
        vertical: 'beauty',
        event_type: 'reminder_24h',
        status: 'emitted',
        channel: 'whatsapp',
        subject_id: 'sub-1',
        customer_id: 'cust-1',
        membership_id: null,
        schedule_id: 'sch-1',
        triggered_by: 'scheduler',
        payload: {},
        occurred_at: '2026-03-19T10:00:00.000Z',
      }),
      makeRow({
        vertical: 'fitness',
        event_type: 'return_campaign_sent',
        status: 'pending',
        channel: 'internal',
        subject_id: 'sub-2',
        customer_id: null,
        membership_id: 'm-2',
        schedule_id: null,
        triggered_by: 'scheduler',
        payload: {},
        occurred_at: '2026-03-19T09:00:00.000Z',
      }),
    ]);

    mockVerticalAttendance.findAll.mockResolvedValueOnce([
      makeRow({
        id: 'va-1',
        vertical: 'fitness',
        subject_id: 'sub-2',
        membership_id: 'm-2',
        checked_in_at: '2026-03-19T08:00:00.000Z',
        checked_out_at: '2026-03-19T08:50:00.000Z',
        status: 'absent',
        duration_minutes: 50,
        unit_id: 'u1',
        device_id: 'd1',
      }),
    ]);

    mockEventLedger.findAll.mockResolvedValueOnce([
      makeRow({
        type: 'MembershipBillingStatusChanged',
        occurred_at: '2026-03-19T07:30:00.000Z',
        correlation_id: 'm-2',
        subject_id: 'sub-2',
        actor_id: 'system',
        payload: { vertical: 'fitness', fromStatus: 'active', toStatus: 'blocked', reason: 'grace_expired' },
      }),
    ]);

    const out = await listTimeline({ tenantId: 'tenant-a', vertical: 'all', limit: 20, page: 1 });

    const statuses = out.items.map((i) => i.status);
    expect(statuses).toContain('provider-dependent');
    expect(statuses).toContain('pending');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('success');
  });

  it('listJobs classifica status e calcula sumário', async () => {
    mockExecutionJob.findAll.mockResolvedValueOnce([
      makeRow({
        id: 'j1',
        kind: 'vertical_beauty_journey_tick',
        tenant_key: 'tenant-a',
        status: 'done',
        attempts: 0,
        processing_at: '2026-03-19T10:00:00.000Z',
        updated_at: '2026-03-19T10:00:02.000Z',
        created_at: '2026-03-19T10:00:00.000Z',
      }),
      makeRow({
        id: 'j2',
        kind: 'vertical_fitness_journey_tick',
        tenant_key: 'tenant-a',
        status: 'dead',
        attempts: 2,
        processing_at: '2026-03-19T10:01:00.000Z',
        updated_at: '2026-03-19T10:01:04.000Z',
        created_at: '2026-03-19T10:01:00.000Z',
        last_error: 'timeout',
      }),
      makeRow({
        id: 'j3',
        kind: 'vertical_reconciliation',
        tenant_key: 'tenant-a',
        status: 'pending',
        attempts: 1,
        processing_at: null,
        updated_at: '2026-03-19T10:02:00.000Z',
        created_at: '2026-03-19T10:02:00.000Z',
      }),
    ]);

    const out = await listJobs({ tenantId: 'tenant-a', vertical: 'all', limit: 50, page: 1 });

    expect(out.summary.executed).toBe(2);
    expect(out.summary.success).toBe(1);
    expect(out.summary.failed).toBe(1);
    expect(out.summary.pending).toBe(1);
    expect(out.items.find((i) => i.id === 'j2').status).toBe('failed');
    expect(out.items.find((i) => i.id === 'j3').status).toBe('pending');
  });

  it('listNotifications usa event_ledger com status sent/failed/skipped/provider-dependent', async () => {
    mockEventLedger.findAll.mockResolvedValueOnce([
      makeRow({
        occurred_at: '2026-03-19T09:00:00.000Z',
        source: 'vertical.notification.whatsapp',
        payload: {
          kind: 'notification_delivery',
          channel: 'whatsapp',
          dashboardStatus: 'provider-dependent',
          destinationMasked: '551***99',
          eventType: 'reminder_24h',
          isStub: true,
        },
      }),
      makeRow({
        occurred_at: '2026-03-19T09:10:00.000Z',
        source: 'vertical.notification.internal',
        payload: {
          kind: 'notification_delivery',
          channel: 'internal',
          dashboardStatus: 'skipped',
          destinationMasked: 'sub***',
          eventType: 'return_campaign_sent',
          isStub: false,
        },
      }),
    ]);

    const out = await listNotifications({
      tenantId: 'tenant-a',
      vertical: 'all',
      channel: 'whatsapp',
      status: 'provider-dependent',
      limit: 20,
      page: 1,
    });

    expect(out.summary.providerDependent).toBe(1);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].channel).toBe('whatsapp');
    expect(out.items[0].status).toBe('provider-dependent');
  });

  it('listNotifications prioriza notification_deliveries quando disponivel', async () => {
    mockNotificationDelivery.findAll.mockResolvedValueOnce([
      makeRow({
        id: 'notif-1',
        tenant_key: 'tenant-a',
        vertical: 'beauty',
        event_type: 'follow_up_sent',
        channel: 'whatsapp',
        recipient_masked: '551***99',
        status: 'sent',
        attempts: 1,
        execution_job_id: 'job-1',
        created_at: '2026-03-19T10:00:00.000Z',
        last_attempt_at: '2026-03-19T10:00:01.000Z',
        sent_at: '2026-03-19T10:00:02.000Z',
      }),
      makeRow({
        id: 'notif-2',
        tenant_key: 'tenant-a',
        vertical: 'fitness',
        event_type: 'billing_overdue',
        channel: 'whatsapp',
        recipient_masked: '552***11',
        status: 'failed',
        attempts: 2,
        execution_job_id: 'job-2',
        created_at: '2026-03-19T09:00:00.000Z',
        last_attempt_at: '2026-03-19T09:02:00.000Z',
        last_error: 'provider_down',
      }),
    ]);

    const out = await listNotifications({
      tenantId: 'tenant-a',
      vertical: 'all',
      limit: 20,
      page: 1,
    });

    expect(out.meta.dataSource).toBe('notification_deliveries');
    expect(out.summary.sent).toBe(1);
    expect(out.summary.failed).toBe(1);
    expect(out.items[0]).toEqual(expect.objectContaining({
      origin: 'notification_deliveries',
    }));
  });

  it('listInsights gera score+motivo e mantém isolamento por tenant no where', async () => {
    mockVerticalJourneyEvent.findAll.mockResolvedValueOnce([
      makeRow({ subject_id: 'beauty-1', customer_id: 'cb-1', membership_id: null }),
    ]);
    mockVerticalAttendance.findAll.mockResolvedValueOnce([]);
    mockAccessMembership.findAll
      .mockResolvedValueOnce([]) // beauty candidates memberships
      .mockResolvedValueOnce([
        makeRow({ id: 'fit-m-1', subject_id: 'fit-1', customer_id: 'cf-1', billing_status: 'delinquent' }),
      ]);

    const out = await listInsights({ tenantId: 'tenant-a', vertical: 'all', limit: 10 });

    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items[0]).toEqual(expect.objectContaining({
      reason: expect.any(String),
      score: expect.any(Number),
    }));

    expect(mockVerticalJourneyEvent.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant_key: 'tenant-a' }),
    }));
  });

  it('listFinancialTransactions lista apenas problemáticos por padrão e agrega resumo financeiro', async () => {
    mockBillingTransaction.findAll.mockResolvedValueOnce([
      makeRow({
        id: 'bt-1',
        tenant_key: 'tenant-a',
        vertical: 'fitness',
        provider: 'asaas',
        type: 'membership',
        status: 'chargeback',
        amount: '199.90',
        currency: 'BRL',
        subject_id: 'fit-1',
        customer_id: 'cust-1',
        membership_id: 'm-1',
        external_transaction_id: 'ext-1',
        metadata: { reason: 'bank_dispute' },
        created_at: '2026-03-19T10:00:00.000Z',
        updated_at: '2026-03-19T10:10:00.000Z',
      }),
      makeRow({
        id: 'bt-2',
        tenant_key: 'tenant-a',
        vertical: 'beauty',
        provider: 'mercado_pago',
        type: 'bundle',
        status: 'overdue',
        amount: '89.00',
        currency: 'BRL',
        customer_id: 'cust-2',
        bundle_id: 'bundle-1',
        external_transaction_id: 'ext-2',
        metadata: {},
        created_at: '2026-03-18T10:00:00.000Z',
        updated_at: '2026-03-18T10:10:00.000Z',
      }),
      makeRow({
        id: 'bt-3',
        tenant_key: 'tenant-a',
        vertical: 'beauty',
        provider: 'asaas',
        type: 'bundle',
        status: 'confirmed',
        amount: '49.00',
        currency: 'BRL',
        customer_id: 'cust-3',
        external_transaction_id: 'ext-3',
        metadata: {},
        created_at: '2026-03-17T10:00:00.000Z',
        updated_at: '2026-03-17T10:10:00.000Z',
      }),
    ]);
    mockEventLedger.findOne.mockResolvedValueOnce(makeRow({
      occurred_at: '2026-03-20T09:00:00.000Z',
      source: 'billing.reconciliation.manual',
      correlation_id: 'corr-1',
      actor_type: 'agent',
      actor_id: 'agent-1',
      payload: {
        kind: 'billing_reconciliation_manual',
        limit: 50,
        transactions: { scanned: 3, updated: 2, unchanged: 1, failed: 0 },
        subscriptions: { scanned: 2, updated: 1, unchanged: 1, failed: 0 },
      },
    }));

    const out = await listFinancialTransactions({
      tenantId: 'tenant-a',
      vertical: 'all',
      problemOnly: true,
      limit: 20,
      page: 1,
    });

    expect(mockBillingTransaction.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenant_key: 'tenant-a',
        status: expect.objectContaining({}),
      }),
    }));
    expect(out.summary.problematicCount).toBe(2);
    expect(out.summary.chargebackCount).toBe(1);
    expect(out.summary.overdueCount).toBe(1);
    expect(out.summary.grossAmount).toBeCloseTo(288.9);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual(expect.objectContaining({
      id: 'bt-1',
      status: 'chargeback',
      provider: 'asaas',
    }));
    expect(out.meta.lastReconciliation).toEqual(expect.objectContaining({
      source: 'billing.reconciliation.manual',
      mode: 'manual',
      correlationId: 'corr-1',
      actorType: 'agent',
      actorId: 'agent-1',
      jobId: null,
      transactions: expect.objectContaining({ updated: 2 }),
      subscriptions: expect.objectContaining({ updated: 1 }),
    }));
  });

  it('retorna vazio quando DB indisponível', async () => {
    getSequelize.mockReturnValueOnce(null);

    const out = await computeSummary({ tenantId: 'tenant-a' });
    expect(out.summary.beauty).toBeNull();
  });
});

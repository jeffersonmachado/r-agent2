'use strict';

const mockPolicyModel = { findOne: jest.fn(), create: jest.fn() };
const mockWaitingListModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };
const mockCampaignModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), sequelize: { transaction: async (handler) => handler({}) } };
const mockCandidateModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn() };
const mockScheduleModel = { findAll: jest.fn(), findOne: jest.fn() };
const mockCrmContactModel = { findAll: jest.fn(), findOne: jest.fn() };
const mockRuntimeModel = { findOne: jest.fn(), create: jest.fn() };
const mockRevenueOpportunityModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };
const mockOperationalMetricSnapshotModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn() };
const mockKioskSessionModel = { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() };

const mockCreateSchedule = jest.fn();
const mockLogActivity = jest.fn();

jest.mock('../../../db/models', () => ({
  AutonomousSchedulePolicy: () => mockPolicyModel,
  AutonomousWaitingList: () => mockWaitingListModel,
  AutonomousGapCampaign: () => mockCampaignModel,
  AutonomousGapCandidate: () => mockCandidateModel,
  OperationalSchedule: () => mockScheduleModel,
  CrmContact: () => mockCrmContactModel,
  AutonomousRuntime: () => mockRuntimeModel,
  RevenueOpportunity: () => mockRevenueOpportunityModel,
  OperationalMetricSnapshot: () => mockOperationalMetricSnapshotModel,
  KioskSession: () => mockKioskSessionModel,
}));

jest.mock('../../../services/schedulingService', () => ({
  createSchedule: (...args) => mockCreateSchedule(...args),
  getAvailability: jest.fn(async () => ({ available: true, slots: [] })),
}));

jest.mock('../../../services/crm/crmService', () => ({
  logActivity: (...args) => mockLogActivity(...args),
}));

jest.mock('../../../services/outboundQueueService', () => ({
  enqueueOutbound: jest.fn(async () => ({ queued: true, itemId: 'outq-1' })),
}));

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const policyService = require('../AutonomousSchedulePolicyService');
const gapDetectionService = require('../GapDetectionService');
const rankingService = require('../CandidateRankingService');
const waitingListService = require('../WaitingListService');
const campaignService = require('../AutonomousCampaignService');
const runtimeService = require('../AutonomousRuntimeService');
const snapshotService = require('../OperationalMetricSnapshotService');
const predictiveInsightsService = require('../PredictiveInsightsService');
const previewRunService = require('../PreviewRunService');
const revenueEngine = require('../../revenue/RevenueEngine');
const recommendationEngine = require('../../insights/RecommendationEngine');
const kioskService = require('../../../channels/kiosk/KioskService');

function makeRow(initial) {
  const state = { ...initial };
  return {
    get id() { return state.id; },
    get contact_id() { return state.contact_id; },
    get metadata() { return state.metadata; },
    get sent_invites() { return state.sent_invites; },
    get closed_reason() { return state.closed_reason; },
    get status() { return state.status; },
    toJSON() { return { ...state }; },
    async update(patch) {
      Object.assign(state, patch);
      return this;
    },
  };
}

function activePolicy(overrides = {}) {
  return makeRow({
    id: 'asp-1',
    tenant_key: 'tenant-1',
    channel: 'whatsapp',
    enabled: true,
    auto_fill_enabled: true,
    waiting_list_enabled: true,
    reactivation_enabled: true,
    min_notice_minutes: 30,
    min_gap_duration_minutes: 30,
    fill_horizon_hours: 48,
    max_invites_per_campaign: 8,
    max_invites_per_contact_day: 2,
    max_invites_per_contact_week: 5,
    cooldown_hours_after_reject: 48,
    cooldown_hours_after_no_response: 24,
    send_window_start: '08:00',
    send_window_end: '19:00',
    allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
    settings: { verticalTemplate: 'beauty', allowedChannels: ['whatsapp'] },
    ...overrides,
  });
}

describe('autonomous scheduling hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicyModel.findOne.mockResolvedValue(null);
    mockPolicyModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockWaitingListModel.findAll.mockResolvedValue([]);
    mockWaitingListModel.findOne.mockResolvedValue(null);
    mockWaitingListModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockCampaignModel.findAll.mockResolvedValue([]);
    mockCampaignModel.findOne.mockResolvedValue(null);
    mockCampaignModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockCandidateModel.findAll.mockResolvedValue([]);
    mockCandidateModel.findOne.mockResolvedValue(null);
    mockCandidateModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockCandidateModel.update.mockResolvedValue([1]);
    mockScheduleModel.findAll.mockResolvedValue([]);
    mockScheduleModel.findOne.mockResolvedValue(null);
    mockCrmContactModel.findAll.mockResolvedValue([]);
    mockCrmContactModel.findOne.mockResolvedValue(null);
    mockCreateSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1' } });
    mockLogActivity.mockResolvedValue({ ok: true });
    mockRuntimeModel.findOne.mockResolvedValue(null);
    mockRuntimeModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockRevenueOpportunityModel.findAll.mockResolvedValue([]);
    mockRevenueOpportunityModel.findOne.mockResolvedValue(null);
    mockRevenueOpportunityModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockOperationalMetricSnapshotModel.findAll.mockResolvedValue([]);
    mockOperationalMetricSnapshotModel.findOne.mockResolvedValue(null);
    mockOperationalMetricSnapshotModel.create.mockImplementation(async (payload) => makeRow(payload));
    mockOperationalMetricSnapshotModel.count.mockResolvedValue(0);
    mockKioskSessionModel.findAll.mockResolvedValue([]);
    mockKioskSessionModel.findOne.mockResolvedValue(null);
    mockKioskSessionModel.create.mockImplementation(async (payload) => makeRow(payload));
  });

  test('cria policy normalizada com preset vertical e minGapDuration', async () => {
    const out = await policyService.upsertPolicy({
      tenantId: 'tenant-1',
      patch: {
        settings: { verticalTemplate: 'fitness', allowedChannels: ['whatsapp'], preferredTimeWindows: [{ start: '06:00', end: '09:00' }] },
      },
    });

    expect(mockPolicyModel.create).toHaveBeenCalledTimes(1);
    expect(mockPolicyModel.create.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      min_gap_duration_minutes: 30,
      settings: expect.objectContaining({ verticalTemplate: 'fitness' }),
    });
    expect(out.policy.settings.verticalTemplate).toBe('fitness');
    expect(out.policy.settings.minGapDurationMinutes).toBeGreaterThanOrEqual(30);
  });

  test('detecta gap vendável respeitando notice e gap mínimo', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy({ min_gap_duration_minutes: 45, settings: { verticalTemplate: 'beauty', serviceType: 'corte' } }));
    mockScheduleModel.findAll.mockResolvedValue([
      makeRow({
        id: 'sch-a',
        tenant_key: 'tenant-1',
        owner_id: 'owner-1',
        context_type: 'ticket',
        context_id: 'ticket-1',
        start_at: new Date('2026-03-06T10:00:00.000Z'),
        end_at: new Date('2026-03-06T10:30:00.000Z'),
        metadata: { serviceType: 'corte' },
        status: 'scheduled',
      }),
      makeRow({
        id: 'sch-b',
        tenant_key: 'tenant-1',
        owner_id: 'owner-1',
        context_type: 'ticket',
        context_id: 'ticket-2',
        start_at: new Date('2026-03-06T11:30:00.000Z'),
        end_at: new Date('2026-03-06T12:00:00.000Z'),
        metadata: { serviceType: 'corte' },
        status: 'scheduled',
      }),
    ]);

    const out = await gapDetectionService.detectOpenGaps({
      tenantId: 'tenant-1',
      now: new Date('2026-03-06T09:00:00.000Z'),
      ownerId: 'owner-1',
    });

    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ ownerId: 'owner-1', serviceType: 'corte' });
  });

  test('gera ranking priorizando waiting list com score breakdown', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy());
    mockWaitingListModel.findAll.mockResolvedValue([
      makeRow({
        id: 'awl-1',
        tenant_key: 'tenant-1',
        contact_id: 'contact-priority',
        priority: 95,
        active: true,
        preferred_weekdays: [5],
        preferred_time_windows: [{ start: '10:00', end: '12:00' }],
        metadata: {},
      }),
    ]);
    mockCrmContactModel.findAll.mockResolvedValue([
      makeRow({
        id: 'contact-priority',
        tenant_key: 'tenant-1',
        name: 'Cliente Prioritario',
        phone: '+5511999990001',
        status: 'active',
        attributes: { preferredServices: ['corte'], responseRate: 0.9 },
      }),
      makeRow({
        id: 'contact-regular',
        tenant_key: 'tenant-1',
        name: 'Cliente Regular',
        phone: '+5511999990002',
        status: 'active',
        attributes: { preferredServices: ['corte'] },
      }),
    ]);

    const out = await rankingService.rankCandidatesForGap({
      tenantId: 'tenant-1',
      gap: {
        serviceType: 'corte',
        gapStartAt: '2026-03-06T10:30:00.000Z',
        gapEndAt: '2026-03-06T11:15:00.000Z',
      },
    });

    expect(out.ok).toBe(true);
    expect(out.items[0].contactId).toBe('contact-priority');
    expect(out.items[0].scoreBreakdown.waitingList).toBeGreaterThan(0);
  });

  test('deduplica waiting list ativa equivalente e permite desativar', async () => {
    const existing = makeRow({
      id: 'awl-1',
      tenant_key: 'tenant-1',
      contact_id: 'contact-1',
      desired_channel: 'whatsapp',
      service_type: 'corte',
      active: true,
      preferred_weekdays: [],
      preferred_time_windows: [],
      priority: 80,
      metadata: {},
    });
    mockCrmContactModel.findOne.mockResolvedValue(makeRow({ id: 'contact-1', tenant_key: 'tenant-1', name: 'Contato 1', phone: '5511999999999' }));
    mockWaitingListModel.findAll.mockResolvedValue([existing]);
    mockWaitingListModel.findOne.mockResolvedValue(existing);

    const createOut = await waitingListService.addWaitingEntry({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      desiredChannel: 'whatsapp',
      serviceType: 'corte',
      priority: 80,
    });
    expect(createOut.created).toBe(false);

    mockWaitingListModel.findAll.mockResolvedValue([]);
    const deactivateOut = await waitingListService.deactivateWaitingEntry({
      tenantId: 'tenant-1',
      waitingListId: 'awl-1',
    });
    expect(deactivateOut.item.active).toBe(false);
  });

  test('deduplica campanha pelo fingerprint do gap', async () => {
    const createdRow = makeRow({
      id: 'agc-1',
      tenant_key: 'tenant-1',
      context_type: 'ticket',
      context_id: 'ticket-1',
      status: 'open',
      gap_fingerprint: 'fp-1',
      gap_start_at: new Date('2026-03-06T10:30:00.000Z'),
      gap_end_at: new Date('2026-03-06T11:00:00.000Z'),
      timezone: 'UTC',
      max_invites: 8,
      sent_invites: 0,
      metadata: {},
    });
    mockPolicyModel.findOne.mockResolvedValue(activePolicy());
    mockCampaignModel.create.mockResolvedValue(createdRow);
    mockCampaignModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdRow);

    const gap = {
      contextType: 'ticket',
      contextId: 'ticket-1',
      ownerId: 'owner-1',
      gapStartAt: '2026-03-06T10:30:00.000Z',
      gapEndAt: '2026-03-06T11:00:00.000Z',
      timezone: 'UTC',
    };
    const first = await campaignService.createCampaign({ tenantId: 'tenant-1', gap });
    const second = await campaignService.createCampaign({ tenantId: 'tenant-1', gap });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  test('reject aplica cooldown e mantém resposta previsível', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy());
    const campaignRow = makeRow({
      id: 'agc-1',
      tenant_key: 'tenant-1',
      status: 'running',
      context_type: 'ticket',
      context_id: 'ticket-1',
      gap_start_at: new Date('2026-03-06T10:30:00.000Z'),
      gap_end_at: new Date('2026-03-06T11:00:00.000Z'),
      metadata: {},
    });
    const candidateRow = makeRow({
      id: 'cand-1',
      tenant_key: 'tenant-1',
      campaign_id: 'agc-1',
      contact_id: 'contact-1',
      invite_status: 'sent',
      metadata: {},
    });
    mockCampaignModel.findOne.mockResolvedValue(campaignRow);
    mockCandidateModel.findOne.mockResolvedValue(candidateRow);

    const out = await campaignService.rejectCandidate({ tenantId: 'tenant-1', campaignId: 'agc-1', candidateId: 'cand-1' });
    expect(out.candidate.inviteStatus).toBe('rejected');
    expect(out.candidate.cooldownUntil).toBeTruthy();
  });

  test('accept é idempotente e cria schedule uma única vez', async () => {
    const campaignRow = makeRow({
      id: 'agc-1',
      tenant_key: 'tenant-1',
      status: 'running',
      context_type: 'ticket',
      context_id: 'ticket-1',
      channel: 'whatsapp',
      owner_id: 'owner-1',
      gap_start_at: new Date('2026-03-06T10:30:00.000Z'),
      gap_end_at: new Date('2026-03-06T11:00:00.000Z'),
      timezone: 'UTC',
      metadata: {},
    });
    const candidateRow = makeRow({
      id: 'cand-1',
      tenant_key: 'tenant-1',
      campaign_id: 'agc-1',
      contact_id: 'contact-1',
      invite_status: 'sent',
      metadata: {},
    });
    mockCampaignModel.findOne.mockResolvedValue(campaignRow);
    mockCandidateModel.findOne.mockResolvedValue(candidateRow);
    mockScheduleModel.findOne.mockResolvedValue(null);

    const first = await campaignService.acceptCandidate({
      tenantId: 'tenant-1',
      campaignId: 'agc-1',
      candidateId: 'cand-1',
      actor: { agentId: 'agent-1' },
    });
    expect(first.ok).toBe(true);
    expect(mockCreateSchedule).toHaveBeenCalledTimes(1);

    await candidateRow.update({ invite_status: 'accepted' });
    await campaignRow.update({ status: 'filled', accepted_contact_id: 'contact-1' });
    const second = await campaignService.acceptCandidate({
      tenantId: 'tenant-1',
      campaignId: 'agc-1',
      candidateId: 'cand-1',
      actor: { agentId: 'agent-1' },
    });
    expect(second.idempotent).toBe(true);
    expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
  });

  test('upsert de runtime respeita defaults do template e lê runtime efetivo', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy({ settings: { verticalTemplate: 'food', allowedChannels: ['whatsapp', 'kiosk'] } }));

    const out = await runtimeService.upsertRuntime({
      tenantId: 'tenant-1',
      patch: { autoDetectEnabled: true, safetyMode: 'guarded', enabledChannelsJson: ['whatsapp', 'kiosk'] },
    });
    expect(out.runtime.autoDetectEnabled).toBe(true);
    expect(out.runtime.enabledChannelsJson).toEqual(['whatsapp', 'kiosk']);
  });

  test('predictive insights e revenue usam métricas agregadas sem abrir domínio paralelo', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy());
    mockCrmContactModel.findAll.mockResolvedValue([
      makeRow({ id: 'contact-1', tenant_key: 'tenant-1', name: 'Contato 1', status: 'active' }),
    ]);
    mockCampaignModel.findAll.mockResolvedValue([
      makeRow({
        id: 'agc-1',
        tenant_key: 'tenant-1',
        status: 'expired',
        gap_start_at: new Date('2026-03-06T10:30:00.000Z'),
        closed_at: new Date('2026-03-06T10:50:00.000Z'),
        metadata: { verticalTemplate: 'beauty' },
      }),
    ]);
    mockCandidateModel.findAll.mockResolvedValue([
      makeRow({ id: 'cand-1', tenant_key: 'tenant-1', campaign_id: 'agc-1', invite_status: 'expired' }),
    ]);
    mockScheduleModel.findAll.mockResolvedValue([]);

    const insightsOut = await predictiveInsightsService.getInsights({ tenantId: 'tenant-1' });
    const revenueOut = await revenueEngine.detectOpportunities({ tenantId: 'tenant-1' });

    expect(insightsOut.ok).toBe(true);
    expect(['low', 'medium', 'high']).toContain(insightsOut.insights.idleRisk);
    expect(revenueOut.ok).toBe(true);
    expect(revenueOut.items.length).toBeGreaterThan(0);
  });

  test('gera snapshot manual e lista snapshots persistidos', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy({ settings: { verticalTemplate: 'beauty', serviceType: 'corte', allowedChannels: ['whatsapp'] } }));
    mockCampaignModel.findAll.mockResolvedValue([
      makeRow({
        id: 'agc-1',
        tenant_key: 'tenant-1',
        service_type: 'corte',
        status: 'filled',
        gap_start_at: new Date('2026-03-06T10:30:00.000Z'),
        created_at: new Date('2026-03-06T08:00:00.000Z'),
        started_at: new Date('2026-03-06T08:05:00.000Z'),
        closed_at: new Date('2026-03-06T08:35:00.000Z'),
        metadata: { verticalTemplate: 'beauty' },
      }),
    ]);
    mockCandidateModel.findAll.mockResolvedValue([
      makeRow({ id: 'cand-1', tenant_key: 'tenant-1', campaign_id: 'agc-1', invite_status: 'accepted' }),
    ]);
    mockScheduleModel.findAll.mockResolvedValue([]);

    const created = await snapshotService.createSnapshots({ tenantId: 'tenant-1', snapshotDate: '2026-03-06' });
    expect(created.created).toBe(1);
    expect(mockOperationalMetricSnapshotModel.create).toHaveBeenCalledTimes(1);

    mockOperationalMetricSnapshotModel.findAll.mockResolvedValue([
      makeRow({ id: 'oms-1', tenant_key: 'tenant-1', snapshot_date: '2026-03-06', vertical_template: 'beauty', service_type: 'corte' }),
    ]);
    const listed = await snapshotService.listSnapshots({ tenantId: 'tenant-1' });
    expect(listed.items).toHaveLength(1);
  });

  test('recommendation engine retorna recomendações coerentes e preview run não tem efeitos colaterais', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy({ settings: { verticalTemplate: 'food', serviceType: 'food_order', allowedChannels: ['whatsapp', 'kiosk'] } }));
    mockRuntimeModel.findOne.mockResolvedValue(makeRow({
      id: 'art-1',
      tenant_key: 'tenant-1',
      predictive_enabled: true,
      revenue_enabled: true,
      kiosk_enabled: true,
      snapshot_generation_enabled: false,
      recommendations_enabled: true,
      simulation_mode: true,
      auto_detect_enabled: false,
      auto_campaign_enabled: false,
      auto_expire_enabled: true,
      run_interval_minutes: 10,
      max_campaigns_per_run: 5,
      max_invites_per_run: 20,
      max_recommendations_per_run: 10,
      max_snapshots_per_day: 5,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      enabled_channels_json: ['whatsapp', 'kiosk'],
      safety_mode: 'manual',
      runtime_notes: '',
    }));
    mockCampaignModel.findAll.mockResolvedValue([
      makeRow({
        id: 'agc-1',
        tenant_key: 'tenant-1',
        service_type: 'food_order',
        status: 'running',
        gap_start_at: new Date('2026-03-06T12:00:00.000Z'),
        gap_end_at: new Date('2026-03-06T12:30:00.000Z'),
        created_at: new Date('2026-03-06T09:00:00.000Z'),
        metadata: { verticalTemplate: 'food' },
      }),
    ]);
    mockCandidateModel.findAll.mockResolvedValue([
      makeRow({ id: 'cand-1', tenant_key: 'tenant-1', campaign_id: 'agc-1', invite_status: 'sent' }),
    ]);
    mockScheduleModel.findAll.mockResolvedValue([]);
    mockRevenueOpportunityModel.findAll.mockResolvedValue([
      makeRow({ id: 'rev-1', tenant_key: 'tenant-1', type: 'upsell', confidence: 0.5, metadata: { reasons: [{ code: 'revenue_recovery', message: 'rec' }] } }),
    ]);
    mockKioskSessionModel.findAll.mockResolvedValue([
      makeRow({ id: 'kiosk-1', tenant_key: 'tenant-1', status: 'open', kiosk_code: 'food-1' }),
    ]);

    const recommendations = await recommendationEngine.listRecommendations({ tenantId: 'tenant-1' });
    expect(recommendations.ok).toBe(true);
    expect(recommendations.items.some((item) => item.type === 'kiosk_opportunity')).toBe(true);

    const preview = await previewRunService.previewRun({ tenantId: 'tenant-1', serviceType: 'food_order' });
    expect(preview.preview.wouldExecuteRealActions).toBe(false);
    expect(mockCreateSchedule).not.toHaveBeenCalled();
  });

  test('runtime ampliado valida flags e kiosk session fica enriquecida', async () => {
    mockPolicyModel.findOne.mockResolvedValue(activePolicy({ settings: { verticalTemplate: 'food', allowedChannels: ['whatsapp', 'kiosk'] } }));
    const runtimeOut = await runtimeService.upsertRuntime({
      tenantId: 'tenant-1',
      patch: {
        kioskEnabled: true,
        recommendationsEnabled: false,
        simulationMode: true,
        maxRecommendationsPerRun: 99,
        runtimeNotes: 'observacao',
      },
    });
    expect(runtimeOut.runtime.kioskEnabled).toBe(true);
    expect(runtimeOut.runtime.maxRecommendationsPerRun).toBe(0);
    expect(runtimeOut.reasons.some((item) => item.code === 'runtime_disabled')).toBe(true);

    const kioskOut = await kioskService.createSession({
      tenantId: 'tenant-1',
      kioskCode: 'food-1',
      contactId: 'contact-1',
      ticketId: 'ticket-1',
      contextPayload: { source: 'support' },
    });
    expect(kioskOut.ok).toBe(true);
    expect(mockKioskSessionModel.create).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'contact-1',
      ticket_id: 'ticket-1',
      context_payload: { source: 'support' },
    }));
  });
});

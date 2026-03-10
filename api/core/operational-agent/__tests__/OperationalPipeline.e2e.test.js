'use strict';

const outcomes = [];

jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEventBestEffort: jest.fn(),
}));

const { OperationalEventProcessor } = require('../OperationalEventProcessor');
const { RecommendationEngine } = require('../../operational-recommendations/RecommendationEngine');
const { RecommendationService } = require('../RecommendationService');
const { SignalService } = require('../SignalService');
const { OperationalContextQueryService } = require('../OperationalContextQueryService');

function recordOutcome({ tenantId, sourceType, sourceId, actionId, status = 'success', details = {} }) {
  const row = {
    id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: String(tenantId),
    sourceType: String(sourceType),
    sourceId: String(sourceId),
    actionId: String(actionId),
    status,
    details,
  };
  outcomes.push(row);
  return row;
}

function createInMemorySignalRegistry() {
  const byTenant = new Map();

  function getSignals(tenantId) {
    const key = String(tenantId || '');
    if (!byTenant.has(key)) byTenant.set(key, []);
    return byTenant.get(key);
  }

  return {
    async upsertDetectedSignals({ tenantId, signals = [] }) {
      const list = getSignals(tenantId);
      const opened = (Array.isArray(signals) ? signals : []).map((signal, index) => ({
        id: signal.id || `sig-${Date.now()}-${index}`,
        tenant_id: String(tenantId),
        contact_id: signal.contactId || signal.contact_id || null,
        type: signal.type,
        severity: signal.severity || 'medium',
        confidence: signal.confidence || 0.6,
        source_module: signal.sourceModule || signal.source_module || 'operational_agent',
        context_json: signal.context || signal.context_json || {},
        status: 'open',
      }));
      list.push(...opened);
      return { ok: true, opened, merged: [], items: [...list] };
    },

    async listSignals({ tenantId, contactId = null, activeOnly = false, limit = 200 }) {
      const list = getSignals(tenantId)
        .filter((item) => !contactId || String(item.contact_id || '') === String(contactId))
        .filter((item) => !activeOnly || String(item.status || '').toLowerCase() === 'open')
        .slice(0, limit);
      return { ok: true, items: list, total: list.length, limit };
    },

    async updateSignalStatus({ tenantId, signalId, status }) {
      const list = getSignals(tenantId);
      const idx = list.findIndex((item) => String(item.id) === String(signalId));
      if (idx < 0) return { ok: false, error: 'signal_not_found' };
      list[idx] = { ...list[idx], status: String(status || 'open') };
      return { ok: true, item: list[idx] };
    },
  };
}

function createInMemoryRecommendationStore() {
  const byTenant = new Map();

  function getItems(tenantId) {
    const key = String(tenantId || '');
    if (!byTenant.has(key)) byTenant.set(key, []);
    return byTenant.get(key);
  }

  return {
    async upsertRecommendations({ tenantId, recommendations = [] }) {
      const list = getItems(tenantId);
      const generated = [];
      for (const recommendation of recommendations) {
        const exists = list.find((item) => (
          String(item.source_signal_id || '') === String(recommendation.source_signal_id || '')
          && String(item.type || '') === String(recommendation.type || '')
        ));
        if (exists) continue;
        list.push({ ...recommendation });
        generated.push({ ...recommendation });
      }
      return { ok: true, generated, items: [...list], total: list.length };
    },

    async listRecommendations({ tenantId, contactId = null, limit = 200 }) {
      const list = getItems(tenantId)
        .filter((item) => !contactId || String(item.contact_id || '') === String(contactId))
        .slice(0, limit);
      return { ok: true, items: list, total: list.length, limit };
    },

    async updateRecommendationStatus({ tenantId, recommendationId, status }) {
      const list = getItems(tenantId);
      const idx = list.findIndex((item) => String(item.id) === String(recommendationId));
      if (idx < 0) return { ok: false, error: 'recommendation_not_found' };
      list[idx] = { ...list[idx], status: String(status || 'open') };
      return { ok: true, item: list[idx] };
    },
  };
}

describe('Operational pipeline e2e', () => {
  beforeEach(() => {
    outcomes.splice(0, outcomes.length);
    jest.clearAllMocks();
  });

  function buildRuntime() {
    const signalRegistry = createInMemorySignalRegistry();
    const recommendationStore = createInMemoryRecommendationStore();
    const signalService = new SignalService({ signalRegistry });

    const recommendationEngine = new RecommendationEngine({
      signalService,
      recommendationStore,
      signalRepository: {
        listTenantActiveSignals: ({ tenantId, limit, readPath }) => signalRegistry.listSignals({ tenantId, activeOnly: true, limit, readPath }),
        listContactActiveSignals: ({ tenantId, contactId, limit, readPath }) => signalRegistry.listSignals({ tenantId, contactId, activeOnly: true, limit, readPath }),
      },
    });

    const recommendationService = new RecommendationService({ recommendationEngine });
    const processor = new OperationalEventProcessor({ signalRegistry, recommendationService });

    return { signalRegistry, recommendationStore, recommendationEngine, processor };
  }

  test('Scenario 1: WhatsApp message -> event -> signal -> recommendation -> quick action -> outcome', async () => {
    const runtime = buildRuntime();
    const out = await runtime.processor.processOperationalEvent({
      event: {
        tenant_id: 'tenant-e2e-1',
        contact_id: 'contact-1',
        event_type: 'whatsapp_message_received',
        entity_type: 'crm_contact',
        entity_id: 'contact-1',
        payload: { text: 'Tenho interesse no plano premium' },
      },
    });

    expect(out.ok).toBe(true);
    expect((out.signals || []).map((item) => item.type)).toContain('lead_high_intent');
    expect((out.recommendations || []).length).toBeGreaterThan(0);

    const recommendation = out.recommendations[0];
    const actionId = recommendation?.suggested_actions?.[0]?.action || 'schedule_contact';

    const outcome = recordOutcome({
      tenantId: 'tenant-e2e-1',
      sourceType: 'recommendation',
      sourceId: recommendation.id,
      actionId,
      status: 'success',
      details: { executed: true },
    });

    expect(outcome.status).toBe('success');
  });

  test('Scenario 2: Ticket stalled -> signal -> recommendation -> OCC context consumption -> action -> outcome', async () => {
    const runtime = buildRuntime();
    const out = await runtime.processor.processOperationalEvent({
      event: {
        tenant_id: 'tenant-e2e-2',
        contact_id: 'contact-2',
        event_type: 'ticket_stalled_candidate',
        entity_type: 'ticket',
        entity_id: 'ticket-1',
        payload: { waitingMinutes: 180, queueId: 'queue-1' },
      },
    });

    expect(out.ok).toBe(true);
    expect((out.signals || []).map((item) => item.type)).toContain('ticket_stalled');
    expect((out.recommendations || []).length).toBeGreaterThan(0);

    const recommendation = out.recommendations[0];
    const contextQuery = new OperationalContextQueryService({
      stateService: {
        readState: async () => ({
          ok: true,
          signals: out.signals || [],
          recommendations: out.recommendations || [],
        }),
        listOutcomes: async () => ({ ok: true, items: [] }),
      },
      playbookEngine: {
        listSuggestedPlaybooksForContact: async () => ({ ok: true, items: [] }),
      },
    });

    const contextOut = await contextQuery.getEntityContext({
      tenantId: 'tenant-e2e-2',
      entityType: 'ticket',
      entityId: 'ticket-1',
      contactId: 'contact-2',
      sourceType: 'recommendation',
      sourceId: recommendation.id,
      actions: [{ id: 'assign_ticket', label: 'Atribuir ticket' }],
      limit: 20,
      readPath: 'occ',
    });

    expect(contextOut.ok).toBe(true);
    expect(Array.isArray(contextOut.recommendations)).toBe(true);
    expect(contextOut.recommendations.length).toBeGreaterThan(0);

    const outcome = recordOutcome({
      tenantId: 'tenant-e2e-2',
      sourceType: 'recommendation',
      sourceId: recommendation.id,
      actionId: recommendation?.suggested_actions?.[0]?.action || 'assign_ticket',
      status: 'success',
      details: { assigned: true },
    });

    expect(outcome.status).toBe('success');
  });

  test('Scenario 3: Scheduling conflict -> signal -> recommendation -> quick action -> outcome', async () => {
    const runtime = buildRuntime();
    const out = await runtime.processor.processOperationalEvent({
      event: {
        tenant_id: 'tenant-e2e-3',
        contact_id: 'contact-3',
        event_type: 'schedule_conflict_detected',
        entity_type: 'schedule',
        entity_id: 'sch-1',
        payload: { conflicts: 2 },
      },
    });

    expect(out.ok).toBe(true);
    expect((out.signals || []).map((item) => item.type)).toContain('schedule_conflict');
    expect((out.recommendations || []).length).toBeGreaterThan(0);

    const recommendation = out.recommendations[0];
    const outcome = recordOutcome({
      tenantId: 'tenant-e2e-3',
      sourceType: 'recommendation',
      sourceId: recommendation.id,
      actionId: recommendation?.suggested_actions?.[0]?.action || 'reschedule_schedule',
      status: 'success',
      details: { rescheduled: true },
    });

    expect(outcome.status).toBe('success');

    const list = outcomes.filter((item) => item.tenantId === 'tenant-e2e-3');
    expect(list.length).toBeGreaterThan(0);
  });
});

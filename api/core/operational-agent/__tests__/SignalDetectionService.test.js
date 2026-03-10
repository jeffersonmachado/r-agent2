'use strict';

const { SignalDetectionService } = require('../SignalDetectionService');

describe('SignalDetectionService', () => {
  test('detecta sinais de tenant com base no contexto agregado', async () => {
    const service = new SignalDetectionService({
      contextAssembler: {
        assembleTenantContext: jest.fn(async () => ({
          ok: true,
          crmSummary: { eventsRecentCount: 1 },
          scheduleStats: { upcoming: 1, cancelRate: 0.42, canceled: 2, noShow: 2, total: 10 },
          support: { waitingTickets: 12, inProgressTickets: 4 },
          callbacks: { pending: 7 },
          tasks: { open: 11 },
          revenue: { totalOpen: 4 },
          scheduling: { conflictAlerts: 2, unavailableAlerts: 1, doubleBookingAlerts: 1 },
          rag: { available: false, docsIndexed: 0, warnings: [] },
        })),
      },
    });

    const out = await service.detectTenantSignals({ tenantId: 'tenant-1' });
    const types = (out.signals || []).map((item) => item.type);

    expect(out.ok).toBe(true);
    expect(types).toContain('low_occupancy');
    expect(types).toContain('support_backlog_risk');
    expect(types).toContain('high_cancel_rate');
    expect(types).toContain('missed_revenue');
    expect(types).toContain('channel_attention');
    expect(types).toContain('schedule_conflict');
    expect(types).toContain('agent_unavailable');
    expect(types).toContain('double_booking');
    expect(types).toContain('knowledge_gap');
  });

  test('detecta sinais de contato com follow-up e reativação', async () => {
    const service = new SignalDetectionService({
      contextAssembler: {
        assembleContactContext: jest.fn(async () => ({
          ok: true,
          summary: {
            recentActivity: false,
            eventsRecentCount: 0,
            opportunitiesCount: 1,
            revenueOpportunitiesCount: 1,
          },
          callbacks: { pending: 1, overdue: 1 },
          revenue: { hasUpsellOpportunity: true, totalOpen: 2 },
          scheduleStats: { upcoming: 0 },
          flags: { hasScheduleConflict: true, scheduleConflictCount: 2 },
          rag: { available: true, docsIndexed: 0, warnings: [{ code: 'RAG_MISS' }] },
        })),
      },
    });

    const out = await service.detectContactSignals({ tenantId: 'tenant-1', contactId: 'contact-1' });
    const types = (out.signals || []).map((item) => item.type);

    expect(out.ok).toBe(true);
    expect(types).toContain('customer_reactivation');
    expect(types).toContain('followup_overdue');
    expect(types).toContain('upsell_opportunity');
    expect(types).toContain('missed_revenue');
    expect(types).toContain('customer_no_response');
    expect(types).toContain('schedule_conflict');
    expect(types).toContain('double_booking');
    expect(types).toContain('agent_unavailable');
    expect(types).toContain('knowledge_gap');
  });

  test('detecta sinais a partir de eventos canônicos', async () => {
    const service = new SignalDetectionService();

    const outA = await service.detectSignalsFromEvent({
      event: {
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        event_type: 'whatsapp_message_received',
        entity_type: 'crm_contact',
        entity_id: 'contact-1',
        channel: 'whatsapp',
        payload: { text: 'Tenho interesse' },
      },
    });

    const outB = await service.detectSignalsFromEvent({
      event: {
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        event_type: 'ticket_stalled_candidate',
        entity_type: 'ticket',
        entity_id: 'ticket-1',
        payload: { waitingMinutes: 180 },
      },
    });

    const outC = await service.detectSignalsFromEvent({
      event: {
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        event_type: 'schedule_conflict_detected',
        entity_type: 'schedule',
        entity_id: 'sch-1',
        payload: { conflicts: 2 },
      },
    });

    const outD = await service.detectSignalsFromEvent({
      event: {
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        event_type: 'crm_opportunity_created',
        entity_type: 'crm_opportunity',
        entity_id: 'opp-1',
        payload: { opportunityId: 'opp-1', valueCents: 250000 },
      },
    });

    const outE = await service.detectSignalsFromEvent({
      event: {
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        event_type: 'revenue_opportunity_created',
        entity_type: 'revenue_opportunity',
        entity_id: 'rev-1',
        payload: { opportunityType: 'reactivation', estimatedValue: 320 },
      },
    });

    expect(outA.ok).toBe(true);
    expect((outA.signals || []).map((item) => item.type)).toContain('lead_high_intent');

    expect(outB.ok).toBe(true);
    expect((outB.signals || []).map((item) => item.type)).toContain('ticket_stalled');

    expect(outC.ok).toBe(true);
    expect((outC.signals || []).map((item) => item.type)).toContain('schedule_conflict');

    expect(outD.ok).toBe(true);
    expect((outD.signals || []).map((item) => item.type)).toContain('upsell_opportunity');

    expect(outE.ok).toBe(true);
    expect((outE.signals || []).map((item) => item.type)).toContain('customer_reactivation');
  });
});

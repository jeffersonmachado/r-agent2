'use strict';

const { OperationalContextAssembler } = require('../operational-context');
const { SignalDetectorsRegistry } = require('./SignalDetectorsRegistry');

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeEventEnvelope(event = {}) {
  const payload = safeObject(event.payload);
  const metadata = safeObject(event.metadata || payload.metadata);
  const tenantId = safeStr(event.tenantId || event.tenant_id);
  const contactId = safeStr(event.contactId || event.contact_id || payload.contactId || payload.contact_id);
  const entityType = safeStr(event.entityType || event.entity_type || event.referenceType || payload.referenceType || payload.reference_type);
  const entityId = safeStr(event.entityId || event.entity_id || event.referenceId || payload.referenceId || payload.reference_id);
  const eventType = safeStr(event.type || event.event_type);

  return {
    eventId: safeStr(event.eventId || event.event_id || metadata.eventId),
    tenantId,
    contactId,
    eventType,
    entityType,
    entityId,
    channel: safeStr(event.channel || payload.channel),
    payload,
    metadata,
    sourceModule: safeStr(event.sourceModule || event.source_module || payload.sourceModule) || 'operational_event',
    createdAt: safeStr(event.createdAt || event.created_at),
  };
}

function createSignal({
  type,
  tenantId,
  contactId = null,
  severity = 'medium',
  confidence = 0.6,
  context = {},
  sourceModule,
}) {
  return {
    type,
    tenantId: safeStr(tenantId),
    contactId: safeStr(contactId),
    severity,
    confidence,
    context,
    sourceModule,
    detectedAt: new Date().toISOString(),
  };
}

class SignalDetectionService {
  constructor({ contextAssembler, detectorsRegistry } = {}) {
    this.contextAssembler = contextAssembler || new OperationalContextAssembler();
    this.detectorsRegistry = detectorsRegistry || new SignalDetectorsRegistry({ createSignal });
  }

  async detectSignalsFromEvent({ event } = {}) {
    const normalized = normalizeEventEnvelope(event);
    if (!normalized.tenantId) return { ok: false, error: 'tenant_required' };
    if (!normalized.eventType) return { ok: false, error: 'event_type_required' };

    const signals = this.detectorsRegistry.detectEventSignals({
      normalizedEvent: normalized,
    });

    return {
      ok: true,
      tenantId: normalized.tenantId,
      contactId: normalized.contactId,
      event: normalized,
      signals,
    };
  }

  async detectSignalsFromEvents({ events = [] } = {}) {
    const list = Array.isArray(events) ? events : [];
    const items = [];
    for (const event of list) {
      const out = await this.detectSignalsFromEvent({ event });
      if (out.ok) {
        items.push(...(Array.isArray(out.signals) ? out.signals : []));
      }
    }
    return { ok: true, signals: items, total: items.length };
  }

  async detectTenantSignals({ tenantId }) {
    const contextOut = await this.contextAssembler.assembleTenantContext({ tenantId });
    if (!contextOut.ok) return contextOut;

    const signals = [];
    const crmSummary = contextOut.crmSummary || {};
    const scheduleStats = contextOut.scheduleStats || {};
    const support = contextOut.support || {};
    const callbacks = contextOut.callbacks || {};
    const tasks = contextOut.tasks || {};
    const revenue = contextOut.revenue || {};
    const scheduling = contextOut.scheduling || {};
    const rag = contextOut.rag || {};

    const lowOccupancy = Number(scheduleStats.upcoming || 0) <= 2
      && Number(crmSummary.eventsRecentCount || 0) <= 2;
    if (lowOccupancy) {
      signals.push(createSignal({
        type: 'low_occupancy',
        tenantId,
        severity: 'medium',
        confidence: 0.72,
        sourceModule: 'scheduling_service',
        context: {
          upcomingSchedules: Number(scheduleStats.upcoming || 0),
          eventsRecentCount: Number(crmSummary.eventsRecentCount || 0),
        },
      }));
    }

    const waiting = Number(support.waitingTickets || 0);
    const inProgress = Number(support.inProgressTickets || 0);
    if (waiting >= 8 || (waiting > 0 && waiting > (inProgress * 2))) {
      signals.push(createSignal({
        type: 'support_backlog_risk',
        tenantId,
        severity: waiting >= 20 ? 'critical' : 'high',
        confidence: waiting >= 20 ? 0.9 : 0.78,
        sourceModule: 'queue_service',
        context: {
          waitingTickets: waiting,
          inProgressTickets: inProgress,
        },
      }));

      if (waiting >= 15) {
        signals.push(createSignal({
          type: 'ticket_escalation',
          tenantId,
          severity: waiting >= 25 ? 'critical' : 'high',
          confidence: waiting >= 25 ? 0.9 : 0.75,
          sourceModule: 'queue_service',
          context: {
            waitingTickets: waiting,
            inProgressTickets: inProgress,
          },
        }));
      }
    }

    const cancelRate = Number(scheduleStats.cancelRate || 0);
    const canceledCount = Number(scheduleStats.canceled || 0) + Number(scheduleStats.noShow || 0);
    if (cancelRate >= 0.35 && canceledCount >= 3) {
      signals.push(createSignal({
        type: 'high_cancel_rate',
        tenantId,
        severity: cancelRate >= 0.5 ? 'critical' : 'high',
        confidence: Math.max(0.65, Math.min(0.95, cancelRate)),
        sourceModule: 'scheduling_service',
        context: {
          cancelRate,
          canceledCount,
          schedulesTotal: Number(scheduleStats.total || 0),
        },
      }));
    }

    if (Number(revenue.totalOpen || 0) >= 3) {
      signals.push(createSignal({
        type: 'missed_revenue',
        tenantId,
        severity: Number(revenue.totalOpen || 0) >= 8 ? 'high' : 'medium',
        confidence: 0.66,
        sourceModule: 'revenue_engine',
        context: {
          openRevenueOpportunities: Number(revenue.totalOpen || 0),
        },
      }));

      if (Number(revenue.totalOpen || 0) >= 6 && Number(crmSummary.eventsRecentCount || 0) >= 5) {
        signals.push(createSignal({
          type: 'lead_high_intent',
          tenantId,
          severity: 'high',
          confidence: 0.71,
          sourceModule: 'revenue_engine',
          context: {
            openRevenueOpportunities: Number(revenue.totalOpen || 0),
            eventsRecentCount: Number(crmSummary.eventsRecentCount || 0),
          },
        }));
      }
    }

    if (Number(callbacks.pending || 0) >= 5 || Number(tasks.open || 0) >= 10) {
      signals.push(createSignal({
        type: 'channel_attention',
        tenantId,
        severity: 'medium',
        confidence: 0.61,
        sourceModule: 'tasks_service',
        context: {
          pendingCallbacks: Number(callbacks.pending || 0),
          openTasks: Number(tasks.open || 0),
        },
      }));
    }

    if (Number(scheduling.conflictAlerts || 0) > 0) {
      signals.push(createSignal({
        type: 'schedule_conflict',
        tenantId,
        severity: Number(scheduling.conflictAlerts || 0) >= 3 ? 'high' : 'medium',
        confidence: 0.78,
        sourceModule: 'operational_availability',
        context: {
          conflictAlerts: Number(scheduling.conflictAlerts || 0),
          totalAlerts: Number(scheduling.totalAlerts || 0),
        },
      }));
    }

    if (Number(scheduling.doubleBookingAlerts || 0) > 0) {
      signals.push(createSignal({
        type: 'double_booking',
        tenantId,
        severity: Number(scheduling.doubleBookingAlerts || 0) >= 2 ? 'high' : 'medium',
        confidence: 0.83,
        sourceModule: 'operational_availability',
        context: {
          doubleBookingAlerts: Number(scheduling.doubleBookingAlerts || 0),
        },
      }));
    }

    if (Number(scheduling.unavailableAlerts || 0) > 0) {
      signals.push(createSignal({
        type: 'agent_unavailable',
        tenantId,
        severity: Number(scheduling.unavailableAlerts || 0) >= 3 ? 'high' : 'medium',
        confidence: 0.74,
        sourceModule: 'operational_availability',
        context: {
          unavailableAlerts: Number(scheduling.unavailableAlerts || 0),
        },
      }));
    }

    if (rag.available !== true || Number(rag.docsIndexed || 0) === 0 || (Array.isArray(rag.warnings) && rag.warnings.length > 0)) {
      signals.push(createSignal({
        type: 'knowledge_gap',
        tenantId,
        severity: (rag.available !== true || Number(rag.docsIndexed || 0) === 0) ? 'high' : 'medium',
        confidence: (rag.available !== true || Number(rag.docsIndexed || 0) === 0) ? 0.86 : 0.68,
        sourceModule: 'rag_service',
        context: {
          ragAvailable: rag.available === true,
          ragDocsIndexed: Number(rag.docsIndexed || 0),
          ragWarnings: Array.isArray(rag.warnings) ? rag.warnings : [],
        },
      }));
    }

    return {
      ok: true,
      tenantId: safeStr(tenantId),
      signals,
      context: contextOut,
    };
  }

  async detectContactSignals({ tenantId, contactId }) {
    const contextOut = await this.contextAssembler.assembleContactContext({ tenantId, contactId });
    if (!contextOut.ok) return contextOut;

    const signals = [];
    const summary = contextOut.summary || {};
    const callbacks = contextOut.callbacks || {};
    const revenue = contextOut.revenue || {};
    const scheduleStats = contextOut.scheduleStats || {};
    const flags = contextOut.flags || {};
    const rag = contextOut.rag || {};

    if (summary.recentActivity !== true) {
      signals.push(createSignal({
        type: 'customer_reactivation',
        tenantId,
        contactId,
        severity: 'medium',
        confidence: 0.74,
        sourceModule: 'crm_event_service',
        context: {
          recentActivity: summary.recentActivity === true,
          lastEventAt: summary?.lastEvent?.created_at || null,
          eventsRecentCount: Number(summary.eventsRecentCount || 0),
        },
      }));

      signals.push(createSignal({
        type: 'customer_no_response',
        tenantId,
        contactId,
        severity: 'medium',
        confidence: 0.77,
        sourceModule: 'crm_event_service',
        context: {
          recentActivity: summary.recentActivity === true,
          eventsRecentCount: Number(summary.eventsRecentCount || 0),
        },
      }));
    }

    if (Number(callbacks.overdue || 0) > 0 || (Number(scheduleStats.upcoming || 0) === 0 && Number(callbacks.pending || 0) > 0)) {
      signals.push(createSignal({
        type: 'followup_overdue',
        tenantId,
        contactId,
        severity: Number(callbacks.overdue || 0) >= 2 ? 'high' : 'medium',
        confidence: 0.8,
        sourceModule: 'cc_scheduled_callbacks',
        context: {
          callbackPending: Number(callbacks.pending || 0),
          callbackOverdue: Number(callbacks.overdue || 0),
          upcomingSchedules: Number(scheduleStats.upcoming || 0),
        },
      }));
    }

    if (revenue.hasUpsellOpportunity === true) {
      signals.push(createSignal({
        type: 'upsell_opportunity',
        tenantId,
        contactId,
        severity: 'medium',
        confidence: 0.69,
        sourceModule: 'revenue_engine',
        context: {
          openRevenueOpportunities: Number(revenue.totalOpen || 0),
        },
      }));

      if (summary.recentActivity === true && Number(summary.eventsRecentCount || 0) >= 2) {
        signals.push(createSignal({
          type: 'lead_high_intent',
          tenantId,
          contactId,
          severity: 'high',
          confidence: 0.79,
          sourceModule: 'revenue_engine',
          context: {
            recentActivity: true,
            eventsRecentCount: Number(summary.eventsRecentCount || 0),
            openRevenueOpportunities: Number(revenue.totalOpen || 0),
          },
        }));
      }
    }

    if ((summary.recentActivity !== true) && Number(revenue.totalOpen || 0) > 0) {
      signals.push(createSignal({
        type: 'missed_revenue',
        tenantId,
        contactId,
        severity: Number(revenue.totalOpen || 0) >= 3 ? 'high' : 'medium',
        confidence: 0.67,
        sourceModule: 'revenue_engine',
        context: {
          openRevenueOpportunities: Number(revenue.totalOpen || 0),
          opportunitiesCount: Number(summary.opportunitiesCount || 0),
          revenueOpportunitiesCount: Number(summary.revenueOpportunitiesCount || 0),
        },
      }));
    }

    if (flags.hasScheduleConflict === true || Number(flags.scheduleConflictCount || 0) > 0) {
      signals.push(createSignal({
        type: 'schedule_conflict',
        tenantId,
        contactId,
        severity: Number(flags.scheduleConflictCount || 0) >= 2 ? 'high' : 'medium',
        confidence: 0.8,
        sourceModule: 'operational_availability',
        context: {
          scheduleConflictCount: Number(flags.scheduleConflictCount || 0),
          upcomingSchedules: Number(scheduleStats.upcoming || 0),
        },
      }));

      if (Number(flags.scheduleConflictCount || 0) >= 2) {
        signals.push(createSignal({
          type: 'double_booking',
          tenantId,
          contactId,
          severity: 'high',
          confidence: 0.82,
          sourceModule: 'operational_availability',
          context: {
            scheduleConflictCount: Number(flags.scheduleConflictCount || 0),
          },
        }));
      }
    }

    if (Number(scheduleStats.upcoming || 0) === 0 && Number(callbacks.pending || 0) > 0) {
      signals.push(createSignal({
        type: 'agent_unavailable',
        tenantId,
        contactId,
        severity: 'medium',
        confidence: 0.66,
        sourceModule: 'scheduling_service',
        context: {
          upcomingSchedules: Number(scheduleStats.upcoming || 0),
          callbackPending: Number(callbacks.pending || 0),
        },
      }));
    }

    if (rag.available !== true || Number(rag.docsIndexed || 0) === 0 || (Array.isArray(rag.warnings) && rag.warnings.length > 0)) {
      signals.push(createSignal({
        type: 'knowledge_gap',
        tenantId,
        contactId,
        severity: (rag.available !== true || Number(rag.docsIndexed || 0) === 0) ? 'high' : 'medium',
        confidence: (rag.available !== true || Number(rag.docsIndexed || 0) === 0) ? 0.85 : 0.65,
        sourceModule: 'rag_service',
        context: {
          ragAvailable: rag.available === true,
          ragDocsIndexed: Number(rag.docsIndexed || 0),
          ragWarnings: Array.isArray(rag.warnings) ? rag.warnings : [],
        },
      }));
    }

    return {
      ok: true,
      tenantId: safeStr(tenantId),
      contactId: safeStr(contactId),
      signals,
      context: contextOut,
    };
  }
}

module.exports = {
  SignalDetectionService,
};

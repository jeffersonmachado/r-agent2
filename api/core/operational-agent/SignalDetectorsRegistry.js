'use strict';

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class SignalDetectorsRegistry {
  constructor({ createSignal } = {}) {
    this.createSignal = createSignal;
    this.detectors = [
      this.#crmDetectors.bind(this),
      this.#supportDetectors.bind(this),
      this.#schedulingDetectors.bind(this),
      this.#knowledgeDetectors.bind(this),
      this.#relationshipDetectors.bind(this),
    ];
  }

  detectEventSignals({ normalizedEvent } = {}) {
    if (!normalizedEvent || typeof normalizedEvent !== 'object') return [];
    const out = [];
    for (const detector of this.detectors) {
      const items = detector(normalizedEvent) || [];
      if (Array.isArray(items) && items.length > 0) out.push(...items);
    }
    return out;
  }

  #crmDetectors(normalized) {
    const type = String(normalized.eventType || '');
    const payload = normalized.payload || {};
    const metadata = normalized.metadata || {};

    if (type === 'lead_created' || type === 'lead_updated') {
      return [this.createSignal({
        type: 'lead_high_intent',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: type === 'lead_created' ? 'medium' : 'high',
        confidence: type === 'lead_created' ? 0.68 : 0.74,
        sourceModule: 'crm',
        context: {
          eventType: type,
          leadId: safeString(payload.leadId || payload.lead_id || normalized.entityId),
          status: safeString(payload.status || metadata.status),
          score: Number(payload.score || metadata.score || 0),
        },
      })];
    }

    if (type === 'crm_opportunity_created' || type === 'crm_opportunity_updated' || type === 'crm_opportunity_stage_changed') {
      return [this.createSignal({
        type: 'upsell_opportunity',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: 0.72,
        sourceModule: 'crm',
        context: {
          eventType: type,
          opportunityId: safeString(payload.opportunityId || payload.opportunity_id || normalized.entityId),
          pipelineId: safeString(payload.pipelineId || payload.pipeline_id),
          stageId: safeString(payload.stageId || payload.stage_id || payload.toStageId || payload.to_stage_id),
          status: safeString(payload.status || metadata.status),
          valueCents: Number(payload.valueCents || payload.value_cents || 0),
        },
      })];
    }

    if (type === 'crm_opportunity_lost') {
      return [this.createSignal({
        type: 'churn_risk',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'high',
        confidence: 0.76,
        sourceModule: 'crm',
        context: {
          eventType: type,
          opportunityId: safeString(payload.opportunityId || payload.opportunity_id || normalized.entityId),
          valueCents: Number(payload.valueCents || payload.value_cents || 0),
        },
      })];
    }

    if (type === 'crm_opportunity_won') {
      return [this.createSignal({
        type: 'customer_reengaged',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'low',
        confidence: 0.64,
        sourceModule: 'crm',
        context: {
          eventType: type,
          opportunityId: safeString(payload.opportunityId || payload.opportunity_id || normalized.entityId),
          valueCents: Number(payload.valueCents || payload.value_cents || 0),
        },
      })];
    }

    if (type === 'follow_up_created' || type === 'follow_up_scheduled') {
      return [this.createSignal({
        type: 'followup_due',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: 0.75,
        sourceModule: 'crm',
        context: {
          eventType: type,
          dueAt: safeString(payload.dueAt || payload.due_at || payload.reminderAt || payload.reminder_at),
          taskId: safeString(payload.taskId || payload.task_id),
          activityId: safeString(payload.activityId || payload.activity_id),
        },
      })];
    }

    if (type === 'follow_up_completed') {
      return [this.createSignal({
        type: 'customer_reengaged',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'low',
        confidence: 0.62,
        sourceModule: 'crm',
        context: {
          eventType: type,
          taskId: safeString(payload.taskId || payload.task_id),
          completedAt: safeString(payload.completedAt || payload.completed_at),
        },
      })];
    }

    if (type === 'followup_due_candidate') {
      return [this.createSignal({
        type: 'followup_due',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: 0.78,
        sourceModule: 'crm',
        context: {
          eventType: type,
          dueAt: safeString(payload.dueAt || payload.due_at || metadata.dueAt),
          entityType: normalized.entityType,
          entityId: normalized.entityId,
        },
      })];
    }

    return [];
  }

  #supportDetectors(normalized) {
    const type = String(normalized.eventType || '');
    const payload = normalized.payload || {};
    const metadata = normalized.metadata || {};

    if (type === 'ticket_stalled_candidate') {
      return [this.createSignal({
        type: 'ticket_stalled',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: Number(payload.waitingMinutes || 0) >= 120 ? 'high' : 'medium',
        confidence: 0.82,
        sourceModule: 'support',
        context: {
          eventType: type,
          ticketId: normalized.entityId,
          waitingMinutes: Number(payload.waitingMinutes || 0),
          queueId: safeString(payload.queueId || payload.queue_id),
        },
      })];
    }

    if (type === 'ticket_created') {
      return [this.createSignal({
        type: 'channel_attention',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: 0.63,
        sourceModule: 'support',
        context: {
          eventType: type,
          ticketId: safeString(payload.ticketId || payload.ticket_id || normalized.entityId),
          queue: safeString(payload.queue || payload.queueId || payload.queue_id),
          status: safeString(payload.status || metadata.status),
        },
      })];
    }

    if (type === 'ticket_status_changed') {
      const status = String(payload.status || '').toLowerCase();
      const out = [];

      if (status === 'escalated') {
        out.push(this.createSignal({
          type: 'escalation_risk',
          tenantId: normalized.tenantId,
          contactId: normalized.contactId,
          severity: 'high',
          confidence: 0.8,
          sourceModule: 'support',
          context: {
            eventType: type,
            status,
            ticketId: normalized.entityId,
          },
        }));
      }

      if (status === 'waiting') {
        out.push(this.createSignal({
          type: 'ticket_stalled',
          tenantId: normalized.tenantId,
          contactId: normalized.contactId,
          severity: Number(payload.waitingMinutes || payload.waiting_minutes || 0) >= 120 ? 'high' : 'medium',
          confidence: 0.76,
          sourceModule: 'support',
          context: {
            eventType: type,
            ticketId: safeString(payload.ticketId || payload.ticket_id || normalized.entityId),
            queue: safeString(payload.queue || payload.queueId || payload.queue_id),
            waitingMinutes: Number(payload.waitingMinutes || payload.waiting_minutes || 0),
          },
        }));
      }

      if (status === 'closed' || status === 'resolved') {
        out.push(this.createSignal({
          type: 'customer_reengaged',
          tenantId: normalized.tenantId,
          contactId: normalized.contactId,
          severity: 'low',
          confidence: 0.58,
          sourceModule: 'support',
          context: {
            eventType: type,
            ticketId: safeString(payload.ticketId || payload.ticket_id || normalized.entityId),
            status,
          },
        }));
      }

      return out;
    }

    return [];
  }

  #schedulingDetectors(normalized) {
    const type = String(normalized.eventType || '');
    const payload = normalized.payload || {};
    const metadata = normalized.metadata || {};

    if (type === 'schedule_conflict_detected') {
      return [this.createSignal({
        type: 'schedule_conflict',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: Number(payload.conflicts || 1) > 1 ? 'high' : 'medium',
        confidence: 0.84,
        sourceModule: 'scheduling',
        context: {
          eventType: type,
          scheduleId: normalized.entityId,
          conflicts: Number(payload.conflicts || 1),
        },
      })];
    }

    if (type === 'schedule_cancelled') {
      return [this.createSignal({
        type: 'churn_risk',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: 0.67,
        sourceModule: 'scheduling',
        context: {
          eventType: type,
          scheduleId: normalized.entityId,
          reason: safeString(payload.reason || metadata.reason),
        },
      })];
    }

    if (type === 'schedule_created' || type === 'schedule_confirmed' || type === 'schedule_rescheduled') {
      return [this.createSignal({
        type: 'customer_reengaged',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'low',
        confidence: 0.66,
        sourceModule: 'scheduling',
        context: {
          eventType: type,
          scheduleId: safeString(payload.scheduleId || payload.schedule_id || normalized.entityId),
          startAt: safeString(payload.startAt || payload.start_at),
          status: safeString(payload.status || metadata.status),
        },
      })];
    }

    if (type === 'schedule_canceled' || type === 'schedule_no_show') {
      return [this.createSignal({
        type: type === 'schedule_no_show' ? 'high_cancel_rate' : 'churn_risk',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: type === 'schedule_no_show' ? 'high' : 'medium',
        confidence: type === 'schedule_no_show' ? 0.8 : 0.72,
        sourceModule: 'scheduling',
        context: {
          eventType: type,
          scheduleId: safeString(payload.scheduleId || payload.schedule_id || normalized.entityId),
          reason: safeString(payload.reason || metadata.reason),
        },
      })];
    }

    return [];
  }

  #knowledgeDetectors(normalized) {
    const type = String(normalized.eventType || '');
    const payload = normalized.payload || {};
    const metadata = normalized.metadata || {};

    if (type === 'knowledge_gap_detected') {
      return [this.createSignal({
        type: 'knowledge_gap',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'high',
        confidence: 0.86,
        sourceModule: 'rag',
        context: {
          eventType: type,
          topic: safeString(payload.topic || payload.intent || metadata.topic),
          query: safeString(payload.query || metadata.query),
        },
      })];
    }

    return [];
  }

  #relationshipDetectors(normalized) {
    const type = String(normalized.eventType || '');
    const payload = normalized.payload || {};
    const metadata = normalized.metadata || {};

    if (type === 'whatsapp_message_received') {
      const text = String(payload.text || payload.message || '').trim();
      if (!text) return [];
      return [this.createSignal({
        type: 'lead_high_intent',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: 'medium',
        confidence: Math.max(0.6, Math.min(0.95, Number(metadata.intentConfidence || payload.intentConfidence || 0.72))),
        sourceModule: 'whatsapp_integration',
        context: {
          eventType: type,
          channel: normalized.channel || 'whatsapp',
          entityType: normalized.entityType,
          entityId: normalized.entityId,
        },
      })];
    }

    if (type === 'revenue_opportunity_created') {
      const opportunityType = String(payload.opportunityType || payload.opportunity_type || '').toLowerCase();
      return [this.createSignal({
        type: opportunityType === 'reactivation' ? 'customer_reactivation' : 'upsell_opportunity',
        tenantId: normalized.tenantId,
        contactId: normalized.contactId,
        severity: opportunityType === 'retention' ? 'high' : 'medium',
        confidence: Number.isFinite(Number(payload.confidence)) ? Math.max(0, Math.min(1, Number(payload.confidence))) : 0.7,
        sourceModule: 'revenue_engine',
        context: {
          eventType: type,
          opportunityType: opportunityType || null,
          estimatedValue: Number(payload.estimatedValue || payload.estimated_value || 0),
          serviceType: safeString(payload.serviceType || payload.service_type),
        },
      })];
    }

    return [];
  }
}

module.exports = {
  SignalDetectorsRegistry,
};

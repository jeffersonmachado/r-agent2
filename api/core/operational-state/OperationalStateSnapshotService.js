'use strict';

const { OperationalStateService } = require('../operational-agent/OperationalStateService');
const { OCCOperationalStateRepository } = require('../operational-state-v2');
const operationalMetricsService = require('../../services/operationalMetricsService');
const { createOperationalStateSnapshot } = require('../operational-contracts');

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class OperationalStateSnapshotService {
  constructor({ operationalStateService, occStateRepository, metricsService } = {}) {
    this.operationalStateService = operationalStateService || new OperationalStateService();
    this.occStateRepository = occStateRepository || new OCCOperationalStateRepository();
    this.metricsService = metricsService || operationalMetricsService;
  }

  async getSnapshot({ tenantId, contactId = null, limit = 120 } = {}) {
    const [stateOut, metricsOut, actionsOut, outcomesOut] = await Promise.all([
      this.operationalStateService.readState({ tenantId, contactId, limit }),
      contactId
        ? Promise.resolve({ ok: true, snapshot: null })
        : this.metricsService.getLatestTenantSnapshot({ tenantId }).catch(() => ({ ok: false })),
      contactId
        ? Promise.resolve({ ok: true, items: [] })
        : this.occStateRepository.getActivePlaybooks({ tenantId, limit }).catch(() => ({ ok: false, items: [] })),
      this.operationalStateService.listOutcomes({ tenantId, contactId, limit }).catch(() => ({ ok: false, items: [] })),
    ]);

    if (!stateOut?.ok) return stateOut;

    const signals = stateOut.signals || [];
    const recommendations = stateOut.recommendations || [];
    const outcomes = outcomesOut?.ok ? (outcomesOut.items || []) : [];
    const pressurePayload = metricsOut?.snapshot?.payload || metricsOut?.payload || {};
    const waitingCustomers = safeNumber(pressurePayload?.support?.openTickets, signals.length);
    const workloadByAgent = pressurePayload?.support?.workloadByAgent || {};

    return {
      ok: true,
      snapshot: createOperationalStateSnapshot({
        tenantId,
        contactId,
        backlog: signals.length + recommendations.length,
        queuePressure: safeNumber(pressurePayload?.health?.uraStatus === 'red' ? 90 : pressurePayload?.support?.ticketsToday, 0),
        schedulingPressure: safeNumber(pressurePayload?.scheduling?.conflictsDetected, 0),
        openConversations: safeNumber(pressurePayload?.support?.openTickets, 0),
        pendingFollowUps: recommendations.filter((item) => String(item.status || '').toLowerCase() === 'open').length,
        workloadByAgent,
        slaRisk: safeNumber(pressurePayload?.scheduling?.cancelRate, 0),
        escalationRisk: safeNumber(pressurePayload?.ura?.fallbackCount, 0),
        waitingCustomers,
        capacityAvailability: Math.max(0, 100 - safeNumber(pressurePayload?.fitness?.occupancyRate, 0)),
        signals,
        recommendations,
        outcomes,
      }),
      activeActions: actionsOut?.items || [],
      metrics: pressurePayload,
    };
  }
}

module.exports = {
  OperationalStateSnapshotService,
};

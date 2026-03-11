'use strict';

const { operationalOutcomeEngine } = require('../operational-outcomes');

function getOccStateRepository() {
  // Lazy load to avoid circular dependency
  const { OCCOperationalStateRepository } = require('../operational-state-v2');
  return new OCCOperationalStateRepository();
}

/**
 * Queries operational state at the OCC (Operational Command Center) level.
 * Canonical location: api/core/operational-state.
 */
class OperationalOccQueryService {
  constructor({
    outcomeService,
    occStateRepository,
  } = {}) {
    this.outcomeService = outcomeService || operationalOutcomeEngine;
    this.occStateRepository = occStateRepository || getOccStateRepository();
  }

  async listTenantSignals({
    tenantId,
    activeOnly = false,
    limit = 200,
    contactId = null,
    status = null,
    severity = null,
    type = null,
    from = null,
    to = null,
    includeOutcomes = false,
  } = {}) {
    const out = await this.occStateRepository.getSignals({
      tenantId,
      activeOnly,
      limit,
      contactId,
      status,
      severity,
      type,
      from,
      to,
    });

    if (!includeOutcomes || !out?.ok || !Array.isArray(out.items) || out.items.length === 0) {
      return out;
    }

    const signalIds = out.items
      .map((item) => (item && item.id ? String(item.id).trim() : null))
      .filter(Boolean);
    if (signalIds.length === 0) return out;

    const signalDetectedAtById = out.items.reduce((acc, item) => {
      const key = item && item.id ? String(item.id).trim() : null;
      if (!key) return acc;
      acc[key] = item.detected_at || item.created_at || null;
      return acc;
    }, {});

    const outcomeMap = await this.outcomeService.buildOccSignalOutcomeMap({
      tenantId,
      signalIds,
      signalDetectedAtById,
    });

    return {
      ...out,
      items: out.items.map((item) => {
        const signalId = item && item.id ? String(item.id).trim() : null;
        const summary = signalId ? outcomeMap[signalId] : null;
        if (!summary) return item;
        return {
          ...item,
          lastOutcome: summary.lastOutcome || null,
          hasSuccessfulOutcome: Boolean(summary.hasSuccessfulOutcome),
          timeToResolutionMs: summary.timeToResolutionMs ?? null,
        };
      }),
    };
  }

  async listTenantRecommendations({
    tenantId,
    limit = 200,
    contactId = null,
    status = null,
    priority = null,
    type = null,
    from = null,
    to = null,
  } = {}) {
    return this.occStateRepository.getRecommendations({
      tenantId,
      limit,
      contactId,
      status,
      priority,
      type,
      from,
      to,
    });
  }

  async listTenantActivePlaybooks({
    tenantId,
    limit = 120,
    status = null,
    contactId = null,
    from = null,
    to = null,
  } = {}) {
    return this.occStateRepository.getActivePlaybooks({
      tenantId,
      limit,
      status,
      contactId,
      from,
      to,
    });
  }

  async getOperationalKPIs({ tenantId } = {}) {
    return this.occStateRepository.getOperationalKPIs(tenantId);
  }

  async getTopOperationalSignals({ tenantId, from = null, to = null, limit = 5 } = {}) {
    return this.occStateRepository.getTopOperationalSignals(tenantId, { from, to, limit });
  }

  async listTenantOutcomes({
    tenantId,
    sourceType = null,
    sourceId = null,
    actionId = null,
    actionType = null,
    status = null,
    limit = 120,
    contactId = null,
    signalId = null,
    recommendationId = null,
    playbookExecutionId = null,
    outcomeType = null,
    from = null,
    to = null,
  } = {}) {
    return this.outcomeService.listOutcomes({
      tenantId,
      sourceType,
      sourceId,
      actionId,
      actionType,
      status,
      limit,
      contactId,
      signalId,
      recommendationId,
      playbookExecutionId,
      outcomeType,
      from,
      to,
    });
  }
}

module.exports = {
  OperationalOccQueryService,
};

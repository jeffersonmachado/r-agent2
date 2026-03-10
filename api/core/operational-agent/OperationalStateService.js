'use strict';

const { SignalQueryService } = require('./SignalQueryService');
const { RecommendationQueryService } = require('./RecommendationQueryService');
const { operationalOutcomeEngine } = require('../operational-outcomes');

class OperationalStateService {
  constructor({ signalQueryService, recommendationQueryService, outcomeService } = {}) {
    this.signalQueryService = signalQueryService || new SignalQueryService();
    this.recommendationQueryService = recommendationQueryService || new RecommendationQueryService();
    this.outcomeService = outcomeService || operationalOutcomeEngine;
  }

  async readState({ tenantId, contactId = null, limit = 120 } = {}) {
    const [signalsOut, recommendationsOut] = await Promise.all([
      contactId
        ? this.signalQueryService.listContactSignals({ tenantId, contactId, activeOnly: true, limit })
        : this.signalQueryService.listTenantSignals({ tenantId, activeOnly: true, limit }),
      contactId
        ? this.recommendationQueryService.listContactRecommendations({ tenantId, contactId, limit })
        : this.recommendationQueryService.listTenantRecommendations({ tenantId, limit }),
    ]);

    return {
      ok: true,
      signals: signalsOut?.ok ? (signalsOut.items || []) : [],
      recommendations: recommendationsOut?.ok ? (recommendationsOut.items || []) : [],
    };
  }

  async listOutcomes({ tenantId, sourceType = null, sourceId = null, actionId = null, status = null, limit = 120 } = {}) {
    return this.outcomeService.listOutcomes({
      tenantId,
      sourceType,
      sourceId,
      actionId,
      status,
      limit,
    });
  }
}

module.exports = {
  OperationalStateService,
};

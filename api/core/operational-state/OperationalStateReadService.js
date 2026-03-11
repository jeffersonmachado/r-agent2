'use strict';

const { operationalOutcomeEngine } = require('../operational-outcomes');
const { OCCOperationalStateRepository } = require('../operational-state-v2');

class OperationalStateReadService {
  constructor({ occStateRepository, outcomeService } = {}) {
    this.occStateRepository = occStateRepository || new OCCOperationalStateRepository();
    this.outcomeService = outcomeService || operationalOutcomeEngine;
  }

  async readState({ tenantId, contactId = null, limit = 120 } = {}) {
    const [signalsOut, recommendationsOut] = await Promise.all([
      this.occStateRepository.getSignals({
        tenantId,
        contactId,
        activeOnly: true,
        limit,
      }),
      this.occStateRepository.getRecommendations({
        tenantId,
        contactId,
        limit,
      }),
    ]);

    return {
      ok: true,
      signals: signalsOut?.ok ? (signalsOut.items || []) : [],
      recommendations: recommendationsOut?.ok ? (recommendationsOut.items || []) : [],
    };
  }

  async listOutcomes({ tenantId, sourceType = null, sourceId = null, actionId = null, status = null, limit = 120, contactId = null } = {}) {
    return this.outcomeService.listOutcomes({
      tenantId,
      sourceType,
      sourceId,
      actionId,
      status,
      limit,
      contactId,
    });
  }
}

module.exports = {
  OperationalStateReadService,
};
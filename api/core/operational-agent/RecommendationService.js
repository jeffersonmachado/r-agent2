'use strict';

const { RecommendationEngine } = require('../operational-recommendations/RecommendationEngine');

class RecommendationService {
  constructor({ recommendationEngine } = {}) {
    this.recommendationEngine = recommendationEngine || new RecommendationEngine();
  }

  async generateTenantRecommendations({ tenantId, includeSignalGeneration = true } = {}) {
    return this.recommendationEngine.generateForTenant({ tenantId, includeSignalGeneration });
  }

  async generateContactRecommendations({ tenantId, contactId, includeSignalGeneration = true } = {}) {
    return this.recommendationEngine.generateForContact({ tenantId, contactId, includeSignalGeneration });
  }

  async generateRecommendationsForSignals({ tenantId, signals = [] } = {}) {
    return this.recommendationEngine.generateFromSignals({ tenantId, signals });
  }
}

module.exports = {
  RecommendationService,
};

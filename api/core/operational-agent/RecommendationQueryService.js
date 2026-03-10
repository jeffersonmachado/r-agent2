'use strict';

const { RecommendationEngine } = require('../operational-recommendations/RecommendationEngine');

class RecommendationQueryService {
  constructor({ recommendationEngine } = {}) {
    this.recommendationEngine = recommendationEngine || new RecommendationEngine();
  }

  async listTenantRecommendations({ tenantId, limit = 200 } = {}) {
    return this.recommendationEngine.listTenantRecommendations({ tenantId, limit });
  }

  async listContactRecommendations({ tenantId, contactId, limit = 200 } = {}) {
    return this.recommendationEngine.listContactRecommendations({ tenantId, contactId, limit });
  }

  async updateRecommendationStatus({ tenantId, recommendationId, status, actorId = null } = {}) {
    return this.recommendationEngine.updateRecommendationStatus({ tenantId, recommendationId, status, actorId });
  }
}

module.exports = {
  RecommendationQueryService,
};

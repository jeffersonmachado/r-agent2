'use strict';

const recommendationEngine = require('../core/insights/RecommendationEngine');
const { OperationalPipelineService } = require('../core/operational-pipeline');

async function generateRecommendations({ tenantId, contactId = null, includeSignalGeneration = true } = {}) {
  const service = new OperationalPipelineService();
  if (contactId) {
    return service.generateContactRecommendations({ tenantId, contactId, includeSignalGeneration });
  }
  return service.generateTenantRecommendations({ tenantId, includeSignalGeneration });
}

module.exports = {
  ...recommendationEngine,
  generateRecommendations,
};

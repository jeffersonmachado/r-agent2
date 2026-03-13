'use strict';

const { ProcessGapAnalysisService } = require('./processGapAnalysisService');
const { ProcessRecommendationService } = require('./processRecommendationService');

class ProcessOptimizationService {
  constructor({ gapAnalysisService, recommendationService } = {}) {
    this.gapAnalysisService = gapAnalysisService || new ProcessGapAnalysisService();
    this.recommendationService = recommendationService || new ProcessRecommendationService();
  }

  optimize({ compiledProcess, analytics = null, simulation = null } = {}) {
    const gaps = this.gapAnalysisService.analyze({ compiledProcess, analytics, simulation });
    const recommendations = this.recommendationService.buildRecommendations({
      compiledProcess,
      analytics,
      simulation,
      gaps,
    });

    return {
      gaps,
      recommendations,
    };
  }
}

module.exports = {
  ProcessOptimizationService,
};

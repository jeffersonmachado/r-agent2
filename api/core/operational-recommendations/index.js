'use strict';

const { RecommendationEngine } = require('./RecommendationEngine');
const { OutcomeTrackingService } = require('./OutcomeTrackingService');

const recommendationEngine = new RecommendationEngine();
const outcomeTrackingService = new OutcomeTrackingService();

module.exports = {
  RecommendationEngine,
  OutcomeTrackingService,
  recommendationEngine,
  outcomeTrackingService,
};

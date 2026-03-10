'use strict';

const { buildRecommendationFromSignal } = require('../operational-recommendations/RecommendationPolicyService');

class OperationalRecommendationScorer {
  createRecommendationPayloadFromSignal(signal) {
    return buildRecommendationFromSignal(signal);
  }
}

module.exports = {
  OperationalRecommendationScorer,
};

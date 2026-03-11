'use strict';

const { buildRecommendationFromSignal } = require('./RecommendationPolicyService');

class OperationalRecommendationScorer {
  createRecommendationPayloadFromSignal(signal) {
    return buildRecommendationFromSignal(signal);
  }
}

module.exports = {
  OperationalRecommendationScorer,
};

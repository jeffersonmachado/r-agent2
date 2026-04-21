'use strict';

const { normalizeFailures } = require('./failureNormalizer');
const { clusterFailures } = require('./failureClusterer');
const { rankImpacts } = require('./impactRanker');
const { generateFixSuggestions } = require('./fixSuggester');
const { buildFixPlans } = require('./fixPlanner');
const { buildValidationPlans } = require('./validationPlanner');
const { executePatchPlans } = require('./patchExecutor');
const { updateLearningMemory } = require('./learningMemory');

function runLearningPipeline(execution, history = []) {
  const normalized = normalizeFailures(execution, history);
  const clustered = clusterFailures(normalized);
  const ranked = rankImpacts(clustered);
  const suggestions = generateFixSuggestions(ranked);
  const fixPlans = buildFixPlans(suggestions);
  const validationPlans = buildValidationPlans(fixPlans);
  const patchExecutions = executePatchPlans(fixPlans, process.env.RAP_LEARN_MODE || 'suggestion-only');

  const memory = updateLearningMemory((fixPlans.plans || []).map((plan) => ({
    failureSignature: plan.failureSignature,
    clusterId: plan.clusterId,
    state: 'planned',
    suggestionType: plan.proposedFix.type,
    priorityScore: (ranked.ranked || []).find((item) => item.clusterId === plan.clusterId)?.priorityScore || null,
    plan,
    patchStatus: patchExecutions.executions.find((item) => item.failureSignature === plan.failureSignature)?.status || 'suggested',
    validationStatus: 'pending',
    promotionDecision: 'blocked',
  })));

  return {
    normalized,
    clustered,
    ranked,
    suggestions,
    fixPlans,
    validationPlans,
    patchExecutions,
    memory,
  };
}

module.exports = {
  runLearningPipeline,
};

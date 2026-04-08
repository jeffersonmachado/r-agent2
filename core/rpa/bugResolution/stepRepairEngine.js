const { BUG_TYPES } = require('./bugClassification');

class StepRepairEngine {
  repairStep(step = {}, classification = {}, context = {}) {
    const repairedStep = { ...step };
    const type = classification.type || BUG_TYPES.UNKNOWN_ERROR;

    if (type === BUG_TYPES.ASSERTION_MISMATCH && repairedStep.type === 'assert') {
      if (repairedStep.text && !repairedStep.textContains) {
        repairedStep.textContains = repairedStep.text;
        delete repairedStep.text;
      }
      return {
        repairedStep,
        changeType: 'ASSERT_TO_CONTAINS',
        rationale: 'Converted strict assert to contains to reduce brittle text mismatches.',
        confidence: 0.75,
      };
    }

    if (type === BUG_TYPES.RENDER_TIMEOUT) {
      repairedStep.waitBeforeMs = Math.max(Number(repairedStep.waitBeforeMs || 0), 1000);
      return {
        repairedStep,
        changeType: 'INSERT_WAIT',
        rationale: 'Added pre-wait to absorb delayed rendering before interaction.',
        confidence: 0.79,
      };
    }

    if (
      (type === BUG_TYPES.SELECTOR_BROKEN || type === BUG_TYPES.SELECTOR_DRIFT) &&
      context.selectorRepair?.bestCandidate?.selector
    ) {
      repairedStep.selector = context.selectorRepair.bestCandidate.selector;
      return {
        repairedStep,
        changeType: 'REPLACE_SELECTOR',
        rationale: 'Updated step selector with the highest confidence candidate.',
        confidence: Number(context.selectorRepair.bestCandidate.score || 0.7),
      };
    }

    if (type === BUG_TYPES.FLOW_LOGIC_ERROR) {
      repairedStep.preconditions = repairedStep.preconditions || [];
      repairedStep.preconditions.push('validate_current_url_before_step');
      return {
        repairedStep,
        changeType: 'ADD_PRECONDITION',
        rationale: 'Injected a precondition to verify flow alignment before action.',
        confidence: 0.62,
      };
    }

    return {
      repairedStep,
      changeType: 'NO_CHANGE',
      rationale: 'No safe step transformation available for this classification.',
      confidence: 0.2,
    };
  }
}

module.exports = {
  StepRepairEngine,
};

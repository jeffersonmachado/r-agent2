const { BUG_TYPES } = require('./bugClassification');

const RECOVERY_STRATEGIES = Object.freeze({
  WAIT_AND_RETRY: 'WAIT_AND_RETRY',
  WAIT_FOR_VISIBLE: 'WAIT_FOR_VISIBLE',
  WAIT_FOR_NETWORK_IDLE: 'WAIT_FOR_NETWORK_IDLE',
  SCROLL_INTO_VIEW: 'SCROLL_INTO_VIEW',
  REPAIR_SELECTOR: 'REPAIR_SELECTOR',
  REPAIR_STEP: 'REPAIR_STEP',
  REFRESH_PAGE: 'REFRESH_PAGE',
  RELOGIN_AND_RESUME: 'RELOGIN_AND_RESUME',
  FAIL_FAST: 'FAIL_FAST',
});

class RecoveryPlanner {
  plan(input = {}) {
    const classification = input.classification || {};
    const governorSnapshot = input.governorSnapshot || {};

    if (governorSnapshot.recoveryAttempts >= 2) {
      return {
        primaryStrategy: RECOVERY_STRATEGIES.FAIL_FAST,
        strategySequence: [RECOVERY_STRATEGIES.FAIL_FAST],
        reasoning: 'Recovery attempts limit reached by RetryGovernor.',
      };
    }

    if (!classification.recoverable) {
      return {
        primaryStrategy: RECOVERY_STRATEGIES.FAIL_FAST,
        strategySequence: [RECOVERY_STRATEGIES.FAIL_FAST],
        reasoning: 'Classification marked this failure as non-recoverable.',
      };
    }

    let strategySequence;

    switch (classification.type) {
      case BUG_TYPES.SELECTOR_BROKEN:
      case BUG_TYPES.SELECTOR_DRIFT:
        strategySequence = [
          RECOVERY_STRATEGIES.REPAIR_SELECTOR,
          RECOVERY_STRATEGIES.WAIT_FOR_VISIBLE,
          RECOVERY_STRATEGIES.SCROLL_INTO_VIEW,
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
        ];
        break;
      case BUG_TYPES.ELEMENT_NOT_VISIBLE:
        strategySequence = [
          RECOVERY_STRATEGIES.WAIT_FOR_VISIBLE,
          RECOVERY_STRATEGIES.SCROLL_INTO_VIEW,
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
        ];
        break;
      case BUG_TYPES.ELEMENT_DISABLED:
      case BUG_TYPES.VALIDATION_ERROR:
      case BUG_TYPES.ASSERTION_MISMATCH:
        strategySequence = [
          RECOVERY_STRATEGIES.REPAIR_STEP,
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
        ];
        break;
      case BUG_TYPES.RENDER_TIMEOUT:
        strategySequence = [
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
          RECOVERY_STRATEGIES.WAIT_FOR_NETWORK_IDLE,
          RECOVERY_STRATEGIES.REFRESH_PAGE,
        ];
        break;
      case BUG_TYPES.AUTH_SESSION_EXPIRED:
        strategySequence = [
          RECOVERY_STRATEGIES.RELOGIN_AND_RESUME,
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
        ];
        break;
      case BUG_TYPES.NETWORK_FAILURE:
      case BUG_TYPES.BACKEND_5XX:
        strategySequence = [
          RECOVERY_STRATEGIES.WAIT_FOR_NETWORK_IDLE,
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
        ];
        break;
      default:
        strategySequence = [
          RECOVERY_STRATEGIES.WAIT_AND_RETRY,
          RECOVERY_STRATEGIES.FAIL_FAST,
        ];
        break;
    }

    if (strategySequence[strategySequence.length - 1] !== RECOVERY_STRATEGIES.FAIL_FAST) {
      strategySequence.push(RECOVERY_STRATEGIES.FAIL_FAST);
    }

    return {
      primaryStrategy: strategySequence[0],
      strategySequence,
      reasoning: `Planned from classification ${classification.type || 'UNKNOWN_ERROR'}.`,
    };
  }
}

module.exports = {
  RecoveryPlanner,
  RECOVERY_STRATEGIES,
};

const DEFAULT_LIMITS = Object.freeze({
  MAX_STEP_RETRIES: 3,
  MAX_RECOVERY_ATTEMPTS: 2,
  MAX_SELECTOR_REPAIR_ATTEMPTS: 3,
  MAX_TOTAL_STEP_TIME_MS: 120000,
});

class RetryGovernor {
  constructor(options = {}) {
    this.limits = {
      MAX_STEP_RETRIES: Number(options.MAX_STEP_RETRIES || DEFAULT_LIMITS.MAX_STEP_RETRIES),
      MAX_RECOVERY_ATTEMPTS: Number(options.MAX_RECOVERY_ATTEMPTS || DEFAULT_LIMITS.MAX_RECOVERY_ATTEMPTS),
      MAX_SELECTOR_REPAIR_ATTEMPTS: Number(options.MAX_SELECTOR_REPAIR_ATTEMPTS || DEFAULT_LIMITS.MAX_SELECTOR_REPAIR_ATTEMPTS),
      MAX_TOTAL_STEP_TIME_MS: Number(options.MAX_TOTAL_STEP_TIME_MS || DEFAULT_LIMITS.MAX_TOTAL_STEP_TIME_MS),
    };
  }

  createContext(action = {}) {
    return {
      actionType: action.type || null,
      actionSelector: action.selector || null,
      startedAt: Date.now(),
      retryCount: 0,
      recoveryAttempts: 0,
      selectorRepairAttempts: 0,
      attemptedStrategies: [],
      lastPageStateHash: null,
      finalDecision: null,
      finishedAt: null,
    };
  }

  getElapsedMs(context) {
    return Date.now() - context.startedAt;
  }

  canContinue(context) {
    return this.getElapsedMs(context) <= this.limits.MAX_TOTAL_STEP_TIME_MS;
  }

  canRetryStep(context) {
    return context.retryCount < this.limits.MAX_STEP_RETRIES && this.canContinue(context);
  }

  canAttemptRecovery(context) {
    return context.recoveryAttempts < this.limits.MAX_RECOVERY_ATTEMPTS && this.canContinue(context);
  }

  canAttemptSelectorRepair(context) {
    return context.selectorRepairAttempts < this.limits.MAX_SELECTOR_REPAIR_ATTEMPTS && this.canContinue(context);
  }

  registerStepRetry(context) {
    context.retryCount += 1;
    return context.retryCount;
  }

  registerRecoveryAttempt(context, strategy, pageStateHash = null) {
    context.recoveryAttempts += 1;
    if (strategy) context.attemptedStrategies.push(strategy);
    if (pageStateHash) context.lastPageStateHash = pageStateHash;
    return context.recoveryAttempts;
  }

  registerSelectorRepairAttempt(context, pageStateHash = null) {
    context.selectorRepairAttempts += 1;
    if (pageStateHash) context.lastPageStateHash = pageStateHash;
    return context.selectorRepairAttempts;
  }

  markFinalDecision(context, finalDecision) {
    context.finalDecision = finalDecision;
    context.finishedAt = Date.now();
  }

  snapshot(context) {
    return {
      retryCount: context.retryCount,
      recoveryAttempts: context.recoveryAttempts,
      selectorRepairAttempts: context.selectorRepairAttempts,
      attemptedStrategies: [...context.attemptedStrategies],
      lastPageStateHash: context.lastPageStateHash,
      elapsedMs: this.getElapsedMs(context),
      maxTotalStepTimeMs: this.limits.MAX_TOTAL_STEP_TIME_MS,
    };
  }
}

module.exports = {
  RetryGovernor,
  DEFAULT_LIMITS,
};

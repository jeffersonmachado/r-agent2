const { RECOVERY_STRATEGIES } = require('./recoveryPlanner');

class RecoveryExecutor {
  constructor(options = {}) {
    this.selectorRepairEngine = options.selectorRepairEngine;
    this.stepRepairEngine = options.stepRepairEngine;
    this.reloginHandler = options.reloginHandler || null;
    this.defaultWaitMs = Number(options.defaultWaitMs || 1000);
  }

  async execute(input = {}) {
    const startedAt = new Date().toISOString();
    const strategy = input.strategy;

    const result = {
      strategy,
      startedAt,
      endedAt: null,
      success: false,
      evidence: {},
      notes: null,
    };

    try {
      switch (strategy) {
        case RECOVERY_STRATEGIES.WAIT_AND_RETRY:
          await this.waitAndRetry(input);
          result.success = true;
          result.notes = 'Applied wait before retry.';
          break;
        case RECOVERY_STRATEGIES.WAIT_FOR_VISIBLE:
          await this.waitForVisible(input);
          result.success = true;
          result.notes = 'Element became visible.';
          break;
        case RECOVERY_STRATEGIES.WAIT_FOR_NETWORK_IDLE:
          await this.waitForNetworkIdle(input);
          result.success = true;
          result.notes = 'Network reached idle state.';
          break;
        case RECOVERY_STRATEGIES.SCROLL_INTO_VIEW:
          await this.scrollIntoView(input);
          result.success = true;
          result.notes = 'Scrolled target element into viewport.';
          break;
        case RECOVERY_STRATEGIES.REPAIR_SELECTOR:
          result.evidence.selectorRepair = await this.repairSelector(input);
          result.success = !!result.evidence.selectorRepair?.applied;
          result.notes = result.success
            ? 'Selector successfully repaired.'
            : 'Selector repair candidate could not be applied.';
          break;
        case RECOVERY_STRATEGIES.REPAIR_STEP:
          result.evidence.stepRepair = this.repairStep(input);
          result.success = !!result.evidence.stepRepair?.applied;
          result.notes = result.success
            ? 'Step transformed for safer retry.'
            : 'No safe step transformation was found.';
          break;
        case RECOVERY_STRATEGIES.REFRESH_PAGE:
          await this.refreshPage(input);
          result.success = true;
          result.notes = 'Page refreshed for clean state.';
          break;
        case RECOVERY_STRATEGIES.RELOGIN_AND_RESUME:
          result.success = await this.reloginAndResume(input);
          result.notes = result.success
            ? 'Re-login completed successfully.'
            : 'Re-login strategy unavailable or failed.';
          break;
        case RECOVERY_STRATEGIES.FAIL_FAST:
          result.success = false;
          result.notes = 'Fail-fast strategy selected.';
          break;
        default:
          result.success = false;
          result.notes = `Unknown strategy: ${String(strategy)}`;
          break;
      }
    } catch (error) {
      result.success = false;
      result.notes = `Recovery strategy threw an exception: ${error.message}`;
      result.evidence.error = {
        message: error.message,
        stack: error.stack,
      };
    }

    result.endedAt = new Date().toISOString();
    return result;
  }

  async waitAndRetry(input) {
    const page = input.page;
    if (!page) return;
    await page.waitForTimeout(Number(input.waitMs || this.defaultWaitMs));
  }

  async waitForVisible(input) {
    const page = input.page;
    const action = input.action || {};
    if (!page || !action.selector) throw new Error('Selector is required for WAIT_FOR_VISIBLE');
    await page.waitForSelector(action.selector, {
      state: 'visible',
      timeout: Number(action.timeout || 5000),
    });
  }

  async waitForNetworkIdle(input) {
    const page = input.page;
    if (!page) return;
    if (typeof page.waitForLoadState === 'function') {
      await page.waitForLoadState('networkidle', { timeout: Number(input.timeout || 7000) });
      return;
    }
    await page.waitForTimeout(800);
  }

  async scrollIntoView(input) {
    const page = input.page;
    const action = input.action || {};
    if (!page || !action.selector) throw new Error('Selector is required for SCROLL_INTO_VIEW');
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      }
    }, action.selector);
  }

  async repairSelector(input) {
    if (!this.selectorRepairEngine) {
      return { applied: false, reason: 'selectorRepairEngine_not_configured' };
    }

    const action = input.action || {};
    const pageStateSnapshot = input.pageStateSnapshot || {};
    const page = input.page;

    const selectorRepair = this.selectorRepairEngine.repair(action.selector, pageStateSnapshot);
    const candidate = selectorRepair.bestCandidate;

    if (!candidate || !candidate.selector) {
      return {
        applied: false,
        reason: 'no_candidate',
        selectorRepair,
      };
    }

    if (page && typeof page.locator === 'function') {
      const count = await page.locator(candidate.selector).count().catch(() => 0);
      if (count <= 0) {
        return {
          applied: false,
          reason: 'candidate_not_found_on_page',
          selectorRepair,
        };
      }
    }

    action.selector = candidate.selector;

    return {
      applied: true,
      selectorRepair,
      appliedSelector: candidate.selector,
    };
  }

  repairStep(input) {
    if (!this.stepRepairEngine) {
      return { applied: false, reason: 'stepRepairEngine_not_configured' };
    }

    const action = input.action || {};
    const classification = input.classification || {};
    const selectorRepair = input.selectorRepair || null;

    const stepRepair = this.stepRepairEngine.repairStep(action, classification, {
      selectorRepair,
    });

    if (!stepRepair || stepRepair.changeType === 'NO_CHANGE') {
      return {
        applied: false,
        stepRepair,
      };
    }

    Object.assign(action, stepRepair.repairedStep || {});

    return {
      applied: true,
      stepRepair,
    };
  }

  async refreshPage(input) {
    const page = input.page;
    if (!page) return;
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  async reloginAndResume(input) {
    if (typeof this.reloginHandler !== 'function') {
      return false;
    }

    const outcome = await this.reloginHandler({
      page: input.page,
      action: input.action,
      context: input,
    });

    return !!outcome;
  }
}

module.exports = {
  RecoveryExecutor,
};

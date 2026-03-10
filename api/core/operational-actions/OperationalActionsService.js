'use strict';

const { quickActionExecutor } = require('../operational-quick-actions');
const { operationalPlaybookEngine } = require('../operational-playbooks');
const { createOperationalAction } = require('../operational-contracts');

class OperationalActionsService {
  constructor({ actionExecutor, playbookEngine } = {}) {
    this.actionExecutor = actionExecutor || quickActionExecutor;
    this.playbookEngine = playbookEngine || operationalPlaybookEngine;
  }

  async executeFromSignal(params = {}) {
    const out = await this.actionExecutor.executeForSignal(params);
    if (!out?.ok) return out;
    return { ...out, action: createOperationalAction(out.action || { ...params, status: 'executed' }) };
  }

  async executeFromRecommendation(params = {}) {
    const out = await this.actionExecutor.executeForRecommendation(params);
    if (!out?.ok) return out;
    return { ...out, action: createOperationalAction(out.action || { ...params, status: 'executed' }) };
  }

  async startPlaybook(playbookId, context = {}) {
    return this.playbookEngine.startPlaybookExecution(playbookId, context);
  }
}

module.exports = {
  OperationalActionsService,
};

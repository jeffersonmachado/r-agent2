'use strict';

const { ServiceOperationsKernel } = require('../service-operations-kernel');

class OperationalCanonicalPipelineService {
  constructor({
    eventsService,
    signalsService,
    recommendationsService,
    decisionEngine,
    actionsService,
    outcomesService,
    memoryService,
    kernel,
  } = {}) {
    this.kernel = kernel || new ServiceOperationsKernel({
      eventsService,
      signalsService,
      recommendationsService,
      decisionEngine,
      actionsService,
      outcomesService,
      memoryService,
    });
  }

  async runEventDrivenCycle({ event, execute = false, actionId = null, actorId = null } = {}) {
    return this.kernel.runEventDrivenCycle({ event, execute, actionId, actorId });
  }
}

module.exports = {
  OperationalCanonicalPipelineService,
};

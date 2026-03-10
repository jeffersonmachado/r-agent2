'use strict';

const { OperationalEventsService: EventService } = require('../operational-events');
const { OperationalSignalsService: SignalService, operationalSignalsService } = require('../operational-signals');
const { RecommendationEngine: RecommendationService, recommendationEngine } = require('../operational-recommendations');
const { OperationalDecisionEngine: DecisionService } = require('../operational-decision');
const { OperationalActionsService: ActionService, operationalActionsService } = require('../operational-actions');
const { OperationalOutcomeEngine: OutcomeService, operationalOutcomeEngine } = require('../operational-outcomes');
const { OperationalMemoryService, operationalMemoryService } = require('../operational-memory');
const { OperationalPipelineService } = require('./OperationalPipelineService');

const operationalPipelineService = new OperationalPipelineService({
  signalService: operationalSignalsService,
  recommendationService: recommendationEngine,
  actionService: operationalActionsService,
  outcomeService: operationalOutcomeEngine,
  memoryService: operationalMemoryService,
});

module.exports = {
  EventService,
  SignalService,
  RecommendationService,
  DecisionService,
  ActionService,
  OutcomeService,
  OperationalMemoryService,
  OperationalPipelineService,
  operationalPipelineService,
};

'use strict';

const { QuickActionExecutor, quickActionExecutor } = require('../core/operational-quick-actions');
const { OperationalPipelineService } = require('../core/operational-pipeline');

module.exports = {
  QuickActionExecutor,
  quickActionExecutor,
  executeForSignal: (params) => new OperationalPipelineService().executeAction({
    ...params,
    sourceType: 'signal',
    sourceId: params?.signalId,
  }),
  executeForRecommendation: (params) => new OperationalPipelineService().executeAction({
    ...params,
    sourceType: 'recommendation',
    sourceId: params?.recommendationId,
  }),
};

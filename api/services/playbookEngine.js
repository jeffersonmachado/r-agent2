'use strict';

const { OperationalPlaybookEngine, operationalPlaybookEngine } = require('../core/operational-playbooks');
const { OperationalPipelineService } = require('../core/operational-pipeline');

module.exports = {
  OperationalPlaybookEngine,
  operationalPlaybookEngine,
  listPlaybooks: (params) => operationalPlaybookEngine.listPlaybooks(params),
  startPlaybookExecution: (playbookId, context) => new OperationalPipelineService().startPlaybook(playbookId, context),
  executePlaybookStep: (playbookId, params) => operationalPlaybookEngine.executePlaybookStep(playbookId, params),
};

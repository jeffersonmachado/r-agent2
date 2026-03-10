'use strict';

const { PlaybookRegistry, DEFAULT_PLAYBOOKS } = require('./PlaybookRegistry');
const { PlaybookRunner } = require('./PlaybookRunner');
const { PlaybookStepExecutor } = require('./PlaybookStepExecutor');
const { OperationalPlaybookEngine } = require('./OperationalPlaybookEngine');

const playbookRegistry = new PlaybookRegistry({ playbooks: DEFAULT_PLAYBOOKS });
const playbookStepExecutor = new PlaybookStepExecutor();
const playbookRunner = new PlaybookRunner({ stepExecutor: playbookStepExecutor });
const operationalPlaybookEngine = new OperationalPlaybookEngine({
  registry: playbookRegistry,
  runner: playbookRunner,
});

module.exports = {
  PlaybookRegistry,
  PlaybookRunner,
  PlaybookStepExecutor,
  OperationalPlaybookEngine,
  DEFAULT_PLAYBOOKS,
  playbookRegistry,
  operationalPlaybookEngine,
};

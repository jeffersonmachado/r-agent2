'use strict';

const signalStateStoreV2 = require('./OperationalSignalStateStoreV2');
const recommendationStateStoreV2 = require('./OperationalRecommendationStateStoreV2');
const playbookExecutionStateStoreV2 = require('./OperationalPlaybookExecutionStateStoreV2');
const { OperationalStateSnapshotService } = require('./OperationalStateSnapshotService');

let operationalStateSnapshotService = null;

function getOperationalStateSnapshotService() {
  if (!operationalStateSnapshotService) {
    operationalStateSnapshotService = new OperationalStateSnapshotService();
  }
  return operationalStateSnapshotService;
}

module.exports = {
  signalStateStoreV2,
  recommendationStateStoreV2,
  playbookExecutionStateStoreV2,
  OperationalStateSnapshotService,
  get operationalStateSnapshotService() {
    return getOperationalStateSnapshotService();
  },
  getOperationalStateSnapshotService,
};

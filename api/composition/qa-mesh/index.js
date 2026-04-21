'use strict';

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const {
  getRegistry,
  refreshMeshRegistry,
  getLatestExecution,
  getMeshHistory,
  getExecutionById,
  queueMeshRun,
  queueScenarioReplay,
  getQueuedExecutionStatus,
  getMeshSchedulerStatus,
  runScheduled,
  getStabilitySnapshot,
  getStabilityHistory,
  getStabilityFailures,
  getCheckpointsOverview,
  getCheckpointByWaveId,
  getLearnSummary,
  getLearnFailures,
  getLearnSuggestions,
  getLearnPlans,
  getLearnMemory,
} = require('../../services/qaMeshService');
const { createQaMeshRoutes } = require('../../modules/qa-mesh/routes');

function buildQaMeshRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    getRegistry,
    refreshMeshRegistry,
    getLatestExecution,
    getMeshHistory,
    getExecutionById,
    queueMeshRun,
    queueScenarioReplay,
    getQueuedExecutionStatus,
    getMeshSchedulerStatus,
    runScheduled,
    getStabilitySnapshot,
    getStabilityHistory,
    getStabilityFailures,
    getCheckpointsOverview,
    getCheckpointByWaveId,
    getLearnSummary,
    getLearnFailures,
    getLearnSuggestions,
    getLearnPlans,
    getLearnMemory,
  };
}

function createQaMeshExpressRouter() {
  return createQaMeshRoutes({ buildDeps: () => buildQaMeshRouteDeps() });
}

module.exports = {
  buildQaMeshRouteDeps,
  createQaMeshExpressRouter,
};

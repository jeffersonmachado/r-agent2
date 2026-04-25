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
  listWaves,
  listJourneys,
  listJourneyStatus,
  listStepStatus,
  listReplays,
  getReplayById,
  queueWaveExecution,
  reexecuteReplay,
} = require('../../services/qaWavesService');
const { createQaWavesRoutes } = require('../../modules/qa-waves/routes');

function buildQaWavesRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    listWaves,
    listJourneys,
    listJourneyStatus,
    listStepStatus,
    listReplays,
    getReplayById,
    queueWaveExecution,
    reexecuteReplay,
  };
}

function createQaWavesExpressRouter() {
  return createQaWavesRoutes({ buildDeps: () => buildQaWavesRouteDeps() });
}

module.exports = {
  buildQaWavesRouteDeps,
  createQaWavesExpressRouter,
};

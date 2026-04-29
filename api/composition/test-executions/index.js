'use strict';

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const {
  createExecution,
  getExecutionStatus,
  cancelUnifiedExecution,
  getExecutionArtifacts,
  listRecordings,
  startManualRecording,
  stopManualRecording,
  getRecordingStatus,
  listReplayFiles,
  getReplayFile,
  getReportFile,
} = require('../../services/testExecutionService');
const { createTestExecutionsRoutes } = require('../../modules/test-executions/routes');

function buildTestExecutionsRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    createExecution,
    getExecutionStatus,
    cancelUnifiedExecution,
    getExecutionArtifacts,
    listRecordings,
    startManualRecording,
    stopManualRecording,
    getRecordingStatus,
    listReplayFiles,
    getReplayFile,
    getReportFile,
  };
}

function createTestExecutionsExpressRouter() {
  return createTestExecutionsRoutes({ buildDeps: () => buildTestExecutionsRouteDeps() });
}

module.exports = {
  buildTestExecutionsRouteDeps,
  createTestExecutionsExpressRouter,
};

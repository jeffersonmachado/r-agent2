'use strict';

/**
 * Composition root do dominio RPA Tests.
 */

const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createRpaTestsRoutes } = require('../../modules/rpa-tests/routes');

function buildRpaTestsRouteDeps() {
  const {
    listRecordings,
    executeRecording,
    getExecutionStatus,
    cancelExecution,
    continueExecution,
    nextStep,
    deleteRecording,
    startManualRecording,
    stopManualRecording,
    getRecordingStatus,
  } = require('../../services/rpaService');

  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    listRecordings,
    executeRecording,
    getExecutionStatus,
    cancelExecution,
    continueExecution,
    nextStep,
    deleteRecording,
    startManualRecording,
    stopManualRecording,
    getRecordingStatus,
    path,
    fs,
  };
}

function createRpaTestsExpressRouter() {
  return createRpaTestsRoutes({ buildDeps: () => buildRpaTestsRouteDeps() });
}

module.exports = {
  buildRpaTestsRouteDeps,
  createRpaTestsExpressRouter,
};

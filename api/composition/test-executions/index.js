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
  deleteReplayFile,
  deleteAllReplayFiles,
} = require('../../services/testExecutionService');
const {
  listJourneys,
  listJourneyStatus,
  listStepStatus,
  collectScenarioLatestStats,
} = require('../../services/qaWavesService');
const { listLatestScenarios } = require('../../services/qaWavesScenarioService');
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
    deleteReplayFile,
    deleteAllReplayFiles,
    listQaWaveJourneys: listJourneys,
    listQaWaveJourneyStatus: listJourneyStatus,
    listQaWaveStepStatus: listStepStatus,
    listQaWaveScenarios: (filters) => {
      const result = listLatestScenarios(filters);
      const stats = collectScenarioLatestStats();
      const enriched = (Array.isArray(result.items) ? result.items : []).map((item) => {
        const baseId = String(item.id || '').replace(/@v\d+$/i, '');
        const stat = stats.get(item.id) || stats.get(baseId);
        if (!stat) return item;
        return {
          ...item,
          executionStatus: stat.lastStatus || null,
          lastExecutionAt: stat.lastExecutionAt || item.lastExecutionAt || null,
        };
      });
      return { ...result, items: enriched };
    },
  };
}

function createTestExecutionsExpressRouter() {
  return createTestExecutionsRoutes({ buildDeps: () => buildTestExecutionsRouteDeps() });
}

module.exports = {
  buildTestExecutionsRouteDeps,
  createTestExecutionsExpressRouter,
};

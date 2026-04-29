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
  getExecutionStatus,
} = require('../../services/qaWavesService');
const {
  inferScenario,
  generateSeeds,
  validateScenarioPayload,
  saveScenario,
  listLatestScenarios,
  runScenarioExecution,
} = require('../../services/qaWavesScenarioService');
const {
  listWaveExecutions,
} = require('../../services/qaWavesExecutionService');
const {
  getCoverageSummary,
  analyzeCoverageGaps,
  generateScenarioDraft,
  generateSeedsForScenario,
  listDrafts,
  approveDraft,
  rejectDraft,
  evaluateWaveGovernance,
  listGovernanceReports,
} = require('../../services/qaWavesIntelligenceService');
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
    getExecutionStatus,
    inferWaveScenario: inferScenario,
    generateWaveSeeds: generateSeeds,
    validateWaveScenario: validateScenarioPayload,
    saveWaveScenario: saveScenario,
    listWaveScenarios: listLatestScenarios,
    runWaveScenario: runScenarioExecution,
    listWaveExecutions,
    // Intelligence
    getCoverageSummary: () => getCoverageSummary(),
    analyzeWaveCoverageGaps: analyzeCoverageGaps,
    generateWaveScenarioDraft: generateScenarioDraft,
    generateWaveSeedsForScenario: generateSeedsForScenario,
    listWaveDrafts: listDrafts,
    approveWaveDraft: approveDraft,
    rejectWaveDraft: rejectDraft,
    // Governance
    evaluateWaveGovernance,
    listWaveGovernanceReports: listGovernanceReports,
  };
}

function createQaWavesExpressRouter() {
  return createQaWavesRoutes({ buildDeps: () => buildQaWavesRouteDeps() });
}

module.exports = {
  buildQaWavesRouteDeps,
  createQaWavesExpressRouter,
};

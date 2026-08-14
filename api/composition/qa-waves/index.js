'use strict';

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { emitEvent } = require('../../services/websocketService');
const {
  listWaves,
  getGlobalCoverageSummary,
  listJourneys,
  saveJourney,
  deleteJourney,
  listJourneyStatus,
  listStepStatus,
  listReplays,
  getReplayById,
  reexecuteReplay,
  getExecutionStatus,
  collectScenarioLatestStats,
} = require('../../services/qaWavesService');
const {
  inferScenario,
  generateScenarioWithAI,
  generateSeeds,
  validateScenarioPayload,
  saveScenario,
  listLatestScenarios,
  runScenarioExecution,
  deleteScenario,
} = require('../../services/qaWavesScenarioService');
const {
  listWaveExecutions,
  getWaveExecutionHistory,
  clearWaveExecutions,
} = require('../../services/qaWavesExecutionService');
const {
  getCoverageSummary,
  analyzeCoverageGaps,
  getBusinessGaps,
  generateScenarioDraft,
  generateSeedsForScenario,
  listDrafts,
  approveDraft,
  rejectDraft,
  evaluateWaveGovernance,
  listGovernanceReports,
} = require('../../services/qaWavesIntelligenceService');
const {
  buildOperationalSnapshot,
  getOperationalSnapshot,
  analyzeGapsForAutoClosure,
  generateGapClosureReport,
  validatePreflight,
  executeAutonomousGapClosureLoop,
  validateReplayOperationality,
  classifyOperationality,
  buildStagingAutonomousLoopPayload,
  runIntegrationReadinessProbe,
} = require('../../services/qaWavesOperationalService');
const {
  executeScenarioGeneration,
  executeUIStepGeneration,
  executeValidatorGeneration,
  executeSeedGeneration,
  validatePreflightForCapabilities,
  executeFullGenerationBot,
  applyAutoRemediations,
} = require('../../services/qa/autoGenerationBot');
const { reviewVertical } = require('../../services/verticalReviewService');
const { inferJourneyReview, applyJourneyReview } = require('../../services/journeyReviewService');
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
    getWaveCoverageSummary: getGlobalCoverageSummary,
    listJourneys,
    listJourneyStatus,
    saveWaveJourney: saveJourney,
    deleteWaveJourney: deleteJourney,
    listStepStatus,
    listReplays,
    getReplayById,
    queueWaveExecution: runScenarioExecution,
    reexecuteReplay,
    getExecutionStatus,
    inferWaveScenario: generateScenarioWithAI,
    generateWaveSeeds: generateSeeds,
    validateWaveScenario: validateScenarioPayload,
    saveWaveScenario: saveScenario,
    deleteWaveScenario: deleteScenario,
    listWaveScenarios: (filters) => {
      const result = listLatestScenarios(filters);
      const stats = collectScenarioLatestStats();
      const enriched = (Array.isArray(result.items) ? result.items : []).map((item) => {
        // Evidence keyed by baseId (sem sufixo @vN), store usa id com sufixo
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
    runWaveScenario: runScenarioExecution,
    listWaveExecutions,
    getWaveExecutionHistory,
    clearWaveExecutions,
    // Intelligence
    getCoverageSummary: () => getCoverageSummary(),
    analyzeWaveCoverageGaps: analyzeCoverageGaps,
    generateWaveScenarioDraft: generateScenarioDraft,
    generateWaveSeedsForScenario: generateSeedsForScenario,
    listWaveDrafts: listDrafts,
    approveWaveDraft: approveDraft,
    rejectWaveDraft: rejectDraft,
    getBusinessGaps: () => getBusinessGaps(),
    // Governance
    evaluateWaveGovernance,
    listWaveGovernanceReports: listGovernanceReports,
    // Operational Discovery/Gaps
    buildOperationalSnapshot,
    getOperationalSnapshot,
    // Autonomous Gap Closure Engine
    analyzeGapsForAutoClosure,
    generateGapClosureReport,
    validatePreflight,
    executeAutonomousGapClosureLoop,
    validateReplayOperationality,
    classifyOperationality,
    buildStagingAutonomousLoopPayload,
    runIntegrationReadinessProbe,
    // Auto-Generation Bot
    executeScenarioGeneration,
    executeUIStepGeneration,
    executeValidatorGeneration,
    executeSeedGeneration,
    validatePreflightForCapabilities,
    executeFullGenerationBot,
    applyAutoRemediations,
    // Vertical Review (botão "Revisar vertical")
    reviewVertical,
    // Journey Review (fluxo interativo de revisão de jornada)
    reviewJourneyInfer: inferJourneyReview,
    reviewJourneyApply: applyJourneyReview,
    // WS
    emitWavesEvent: (event, payload, options) => emitEvent(event, payload, options),
  };
}

function createQaWavesExpressRouter() {
  return createQaWavesRoutes({ buildDeps: () => buildQaWavesRouteDeps() });
}

module.exports = {
  buildQaWavesRouteDeps,
  createQaWavesExpressRouter,
};

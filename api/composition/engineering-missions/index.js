'use strict';

/**
 * Composition root do domínio Engineering Mission Compiler / Enriquecimento (DEVELOPMENT-only).
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { MISSION_TYPES } = require('../../../engine/engineeringMission/constants');
const { deriveDisplayStatus } = require('../../../engine/engineeringMission/missionStatus');
const missionStore = require('../../services/engineeringMission/missionStoreService');
const missionCompilerService = require('../../services/engineeringMission/missionCompilerService');
const missionApprovalService = require('../../services/engineeringMission/missionApprovalService');
const missionOrchestratorService = require('../../services/engineeringMission/missionOrchestratorService');
const missionReportService = require('../../services/engineeringMission/missionReportService');
const missionReviewService = require('../../services/engineeringMission/missionReviewService');
const missionSelfAssessmentService = require('../../services/engineeringMission/missionSelfAssessmentService');
const { createEngineeringMissionRoutes } = require('../../modules/engineering-missions/routes');

function buildEngineeringMissionRouteDeps() {
  return {
    requireAuth,
    // RBAC real do produto (§19): classificação DEVELOPMENT diz ONDE, permissão diz O QUE.
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    MISSION_TYPES,
    deriveDisplayStatus,
    missionStore,
    missionCompilerService,
    missionApprovalService,
    missionOrchestratorService,
    missionReportService,
    missionReviewService,
    missionSelfAssessmentService,
  };
}

function createEngineeringMissionExpressRouter() {
  return createEngineeringMissionRoutes({ buildDeps: () => buildEngineeringMissionRouteDeps() });
}

module.exports = {
  buildEngineeringMissionRouteDeps,
  createEngineeringMissionExpressRouter,
};

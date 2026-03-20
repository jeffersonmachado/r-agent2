'use strict';

const config = require('../../utils/config');
const logger = require('../../utils/logger');
const { clearLimitersCache, clearRedisRateLimitKeys } = require('../../../infra/rate-limit');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { sendJson, badRequest, hasJsonContentType, parseJsonBody } = require('../../express/httpHelpers');
const { validateInput, ValidationError, schemas } = require('../../utils/inputValidator');
const {
  login: authLogin,
  logout: authLogout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  inviteUser,
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
} = require('../../services/authService');
const {
  createTenant,
  updateTenant,
  listTenants,
  getTenant,
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  getTenantUsage,
  getTenantContext,
  updateTenantContext,
} = require('../../services/tenantService');
const { logAction, queryLogs, getAuditStats, registerGeneration, generateAuditReport } = require('../../services/auditService');
const {
  isSuperAdmin,
  listAllTenants,
  getTenantMetrics,
  impersonateUser,
  blockTenant,
  unblockTenant,
  adjustTenantPlan,
} = require('../../services/superAdminService');
const {
  getOnboardingStatus,
  completeOnboardingStep,
  startOnboarding,
  createInitialTemplates,
  completeOnboarding,
} = require('../../services/onboardingService');
const { setupMfa, verifyMfa, disableMfa, consumeRecoveryCode } = require('../../services/mfaService');
const { triggerWebhooks } = require('../../services/webhookService');
const { emitEvent } = require('../../services/websocketService');
const { generateAiResponse } = require('../../services/aiProviderService');
const { getAIConfig, getDecryptedAPIKey } = require('../../services/tenantAIService');
const ragService = require('../../services/ragService');
const { generateAndValidate } = require('../../services/generate-and-validate');
const { orchestrateGeneration } = require('../../services/generationOrchestrator');
const { executeRpaFlowPipeline, previewRpaFlowPipeline } = require('../../services/rpaFlowPipelineService');
const { listConversations: listChannelConversations, listConversationMessages } = require('../../services/channelConversationService');
const { validateFlow, addUiMessage } = require('../../../engine/validator');
const { validateVoiceFlow } = require('../../utils/voiceFlowValidator');
const { simulateFlow } = require('../../../engine/flowSimulation');
const { buildConversationReplay } = require('../../../engine/replay');
const rpaDependencyResolver = require('../../../engine/rpaDependencyResolver');

function getRequestMethod(req) {
  return (req.method || 'GET').toUpperCase();
}

function getRequestPathname(req) {
  if (typeof req.path === 'string' && req.path) {
    return req.path;
  }

  const url = new URL(req.url || '/', 'http://localhost');
  return url.pathname;
}

/**
 * Cria o builder de contexto do domínio core.
 *
 * @param {object} localDeps Dependências que ainda pertencem ao runtime do server.js
 * @returns {(req: any, res: any) => object}
 */
function createBuildCoreRoutingContext(localDeps) {
  const {
    validateFlowStructure,
    ensureFlowHasMeta,
    flows,
    persistFlowBestEffort,
    deleteFlowBestEffort,
    sessionEvents,
    saveSessionEventsToFile,
    strictTenantMode,
  } = localDeps;

  return function buildCoreRoutingContext(req, res) {
    return {
      req,
      res,
      method: getRequestMethod(req),
      pathname: getRequestPathname(req),
      clearLimitersCache,
      clearRedisRateLimitKeys,
      config,
      requireAuth,
      requirePermission,
      sendJson,
      logger,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      validateInput,
      schemas,
      ValidationError,
      authLogin,
      loginWithRpaToken,
      validateToken,
      authLogout,
      logoutAllSessions,
      logAction,
      isSuperAdmin,
      createTenant,
      getTenant,
      updateTenant,
      deleteTenant,
      listTenants,
      getTenantContext,
      updateTenantContext,
      getTenantUsage,
      suspendTenant,
      reactivateTenant,
      changePlan,
      generateAiResponse,
      registerGeneration,
      requireTenant,
      getAIConfig,
      getDecryptedAPIKey,
      ragService,
      STRICT_TENANT_MODE: strictTenantMode,
      generateAndValidate,
      listAllTenants,
      getTenantMetrics,
      impersonateUser,
      blockTenant,
      unblockTenant,
      adjustTenantPlan,
      getOnboardingStatus,
      startOnboarding,
      completeOnboardingStep,
      completeOnboarding,
      createInitialTemplates,
      listAgents,
      createAgent,
      getAgent,
      updateAgent,
      deleteAgent,
      inviteUser,
      acceptInvitation,
      requestPasswordReset,
      resetPassword,
      setupMfa,
      verifyMfa,
      disableMfa,
      consumeRecoveryCode,
      queryLogs,
      getAuditStats,
      validateFlow,
      validateVoiceFlow,
      validateFlowStructure,
      ensureFlowHasMeta,
      flows,
      persistFlowBestEffort,
      deleteFlowBestEffort,
      triggerWebhooks,
      emitEvent,
      addUiMessage,
      orchestrateGeneration,
      generateAuditReport,
      rpaDependencyResolver,
      previewRpaFlowPipeline,
      executeRpaFlowPipeline,
      simulateFlow,
      sessionEvents,
      saveSessionEventsToFile,
      buildConversationReplay,
      listChannelConversations,
      listConversationMessages,
    };
  };
}

function requireTenant(req, res) {
  const superAdmin = req?.agent ? isSuperAdmin(req.agent) : false;
  const tenantIdRaw = superAdmin ? (req?.tenantId || null) : (req?.tenantId || req?.agent?.tenantId || null);
  const tenantId = typeof tenantIdRaw === 'string' ? tenantIdRaw.trim() : null;
  if (!tenantId) {
    sendJson(res, 403, { error: 'tenant_required' });
    return null;
  }
  return tenantId;
}

module.exports = {
  createBuildCoreRoutingContext,
};

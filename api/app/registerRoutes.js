'use strict';

/**
 * Registro de todas as rotas Express da API.
 *
 * Extrai do buildExpressApp() toda a montagem de routers e o bloco app.use(...).
 * server.js passa a chamar apenas: registerRoutes(app)
 *
 * Cada buildXxxDeps() que não pertence a um domínio próprio permanece aqui.
 * Builders de domínio (tenant, ticket, rag) ficam em api/composition/.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../utils/config');
const logger = require('../utils/logger');

// --- Infra ---
const { checkRateLimit } = require('../../infra/rate-limit');
const { clearLimitersCache, clearRedisRateLimitKeys } = require('../../infra/rate-limit');

// --- Middleware ---
const { requireAuth, requirePermission } = require('../middleware/auth');
const { tenantRateLimitMiddleware } = require('../middleware/tenantRateLimit');
const { createTenantRateLimitMiddleware } = require('../middleware/createTenantRateLimitMiddleware');

// --- HTTP helpers ---
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  setCorsHeaders,
  notFound,
} = require('../express/httpHelpers');

// --- Utils ---
const { validateInput, ValidationError, schemas } = require('../utils/inputValidator');
const { sendApiError, buildApiError } = require('../utils/apiError');
const { parseMultipartFormData } = require('../utils/multipartParser');

// --- Services: auth ---
const {
  login: authLogin,
  logout: authLogout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
} = require('../services/authService');
const { logAction } = require('../services/auditService');
const { isSuperAdmin } = require('../services/superAdminService');

// --- Services: webhooks ---
const {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  getAvailableEvents,
} = require('../services/webhookService');

// --- Services: QA ---
const {
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics,
} = require('../services/qaService');

// --- Services: webscraping ---
const { scrapeUrl, scrapeUrls } = require('../services/webScrapingService');
const {
  getGeneralMetrics,
  getAgentMetrics,
  getDepartmentMetrics,
  getQueueMetrics,
  getTrendMetrics,
  getAllMetrics,
} = require('../services/analyticsService');
const {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
} = require('../services/bulkMessagingService');
const {
  listQuickReplies,
  getQuickReply,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  incrementUsage,
  searchByContext,
} = require('../services/quickRepliesService');

// --- Composition: domínios ---
const { createTenantExpressRouter } = require('../composition/tenant');
const { createTicketExpressRouter } = require('../composition/ticket');

// --- Routers: módulos ---
const { createPublicSystemRoutes } = require('../modules/public-system/routes');
const { createFrontendFallbackRoutes } = require('../modules/frontend-fallback/routes');
const { createAuthRoutes } = require('../modules/auth/routes');
const { createPbxRoutes } = require('../modules/pbx/routes');
const { createVerticalRoutes } = require('../modules/vertical/routes');
const { createWebhooksRoutes } = require('../modules/webhooks/routes');
const { createOperationsDashboardRoutes } = require('../modules/operations-dashboard/routes');
const { createWebScrapingRoutes } = require('../modules/web-scraping/routes');
const { createQaRoutes } = require('../modules/qa/routes');
const { createRpaTestsRoutes } = require('../modules/rpa-tests/routes');
const { createDevManagementRoutes } = require('../modules/dev-management/routes');
const { createIntelligenceRoutes } = require('../modules/intelligence/routes');
const { createMarketIntelligenceRoutes } = require('../modules/market-intelligence/routes');
const { createAccessControlRoutes } = require('../modules/access-control/routes');
const { createVoiceRoutes } = require('../modules/voice/routes');
const { createQueueTicketRoutes } = require('../modules/queue-ticket/routes');
const { createOpsRoutes } = require('../modules/ops/routes');
const { createExecutionLedgerRoutes } = require('../modules/execution-ledger/routes');
const { createSupportDebugRoutes } = require('../modules/support-debug/routes');
const { createPublicApiRoutes } = require('../modules/public-api/routes');
const { createChannelWebhookRoutes } = require('../modules/channel-webhook/routes');
const { createWhatsAppConnectionRoutes } = require('../modules/whatsapp-connection/routes');
const { createWhatsAppIvrRoutes } = require('../modules/whatsapp-ivr/routes');
const { createWhatsAppQrWebhookRoutes } = require('../modules/whatsapp-qr-webhook/routes');
const { createDomainOperationsRoutes } = require('../modules/domain-operations/routes');
const { createDomainBusinessRoutes } = require('../modules/domain-business/routes');
const { createDomainAdminRoutes } = require('../modules/domain-admin/routes');
const { createDomainIdentityRoutes } = require('../modules/domain-identity/routes');
const { createDomainFlowRoutes } = require('../modules/domain-flow/routes');
const { createPlatformAdminRoutes } = require('../modules/platform-admin/routes');
const { createPlatformContentRoutes } = require('../modules/platform-content/routes');
const { createPlatformPublicRoutes } = require('../modules/platform-public/routes');
const { createAnalyticsRoutes } = require('../modules/analytics/routes');
const { createBulkCampaignsRoutes } = require('../modules/bulk-campaigns/routes');
const { createQuickRepliesRoutes } = require('../modules/quick-replies/routes');

// ---------------------------------------------------------------------------
// Builders de dependências (domínios sem composition própria ainda)
// ---------------------------------------------------------------------------

function buildPublicSystemRouteDeps() {
  return {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    config,
    checkRateLimit,
    setCorsHeaders,
    requireAuth,
  };
}

function buildAuthRouteDeps() {
  return {
    sendJson,
    badRequest,
    validateInput,
    schemas,
    ValidationError,
    authLogin,
    loginWithRpaToken,
    validateToken,
    authLogout,
    logoutAllSessions,
    logAction,
    logger,
  };
}

function buildVerticalRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  };
}

function buildPbxRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    parseMultipartFormData,
    logger,
    buildApiError,
    logAction,
  };
}

function buildWebhooksRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    getAvailableEvents,
    listWebhooks,
    getWebhook,
    createWebhook,
    updateWebhook,
    deleteWebhook,
  };
}

function buildOperationsDashboardRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function buildWebScrapingRouteDeps() {
  const { requireExecutionId } = require('../middleware/requireExecutionId');
  const { createPipelineWs } = require('../ws/pipelineEmitter');
  const { emitPipelineStage } = require('../ws/emitPipelineStage');
  const { failGeneration } = require('../services/failGeneration');
  const { GenerationFailureReasons } = require('../constants/GenerationFailureReasons');
  const { ensureExecutionContext, requireStages, updateStage, updateStatus } = require('../services/pipelineExecutionContext');

  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    sendApiError,
    buildApiError,
    setCorsHeaders,
    hasJsonContentType,
    parseJsonBody,
    isSuperAdmin,
    logAction,
    logger,
    scrapeUrl,
    scrapeUrls,
    requireExecutionId,
    createPipelineWs,
    emitPipelineStage,
    ensureExecutionContext,
    requireStages,
    updateStage,
    updateStatus,
    failGeneration,
    GenerationFailureReasons,
  };
}

function buildQaRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    getLatestQaResult,
    getQaHistory,
    getQaStatistics,
    getQaResultById,
    runQaManual,
  };
}

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
  } = require('../services/rpaService');

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

function buildDevManagementRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    isSuperAdmin,
    logAction,
    logger,
    path,
    fs,
  };
}

function buildIntelligenceRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function buildMarketIntelligenceRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function buildAccessControlRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  };
}

function buildVoiceRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function buildAnalyticsRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    getAllMetrics,
    getGeneralMetrics,
    getAgentMetrics,
    getDepartmentMetrics,
    getQueueMetrics,
    getTrendMetrics,
  };
}

function buildBulkCampaignsRouteDeps() {
  return {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
  };
}

function buildQuickRepliesRouteDeps() {
  return {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    listQuickReplies,
    getQuickReply,
    createQuickReply,
    updateQuickReply,
    deleteQuickReply,
    incrementUsage,
    searchByContext,
  };
}

function buildFrontendFallbackDeps() {
  return { fs, path, logger };
}

// ---------------------------------------------------------------------------
// requireTenant local (espelho do server.js — será unificado em ciclo futuro)
// ---------------------------------------------------------------------------

function requireTenant(req, res) {
  const superAdmin = req?.agent ? isSuperAdmin(req.agent) : false;
  const tenantIdRaw = superAdmin
    ? (req?.tenantId || null)
    : (req?.tenantId || req?.agent?.tenantId || null);
  const tenantId = typeof tenantIdRaw === 'string' ? tenantIdRaw.trim() : null;
  if (!tenantId) {
    sendJson(res, 403, { error: 'tenant_required' });
    return null;
  }
  return tenantId;
}

// ---------------------------------------------------------------------------
// registerRoutes — único ponto de montagem de todas as rotas
// ---------------------------------------------------------------------------

/**
 * Registra todos os routers na instância Express.
 *
 * @param {import('express').Application} app
 * @param {{ buildCoreRoutingContext, buildPlatformRoutingContext, buildExtendedRoutingContext }} residualContextBuilders
 */
function registerRoutes(app, { buildCoreRoutingContext, buildPlatformRoutingContext, buildExtendedRoutingContext }) {
  const tenantRateLimitExpressMiddleware = createTenantRateLimitMiddleware({
    config,
    logger,
    tenantRateLimitMiddleware,
    sendJson,
  });

  // --- Routers de domínio (operations, business, admin, identity, flow) ---
  const domainOperationsRouter = createDomainOperationsRoutes({ buildDeps: buildExtendedRoutingContext });
  const domainBusinessRouter = createDomainBusinessRoutes({ buildDeps: buildExtendedRoutingContext });
  const domainAdminRouter = createDomainAdminRoutes({ buildDeps: buildCoreRoutingContext });
  const domainIdentityRouter = createDomainIdentityRoutes({ buildDeps: buildCoreRoutingContext });
  const domainFlowRouter = createDomainFlowRoutes({ buildDeps: buildCoreRoutingContext });
  const platformAdminRouter = createPlatformAdminRoutes({ buildDeps: buildPlatformRoutingContext });
  const platformContentRouter = createPlatformContentRoutes({ buildDeps: buildPlatformRoutingContext });
  const platformPublicRouter = createPlatformPublicRoutes({ buildDeps: buildPlatformRoutingContext });

  // --- Routers modulares ---
  const publicSystemRouter = createPublicSystemRoutes({ buildDeps: () => buildPublicSystemRouteDeps() });
  const authRouter = createAuthRoutes(buildAuthRouteDeps());
  const pbxRouter = createPbxRoutes({ buildDeps: () => buildPbxRouteDeps() });
  const verticalRouter = createVerticalRoutes({ buildDeps: () => buildVerticalRouteDeps() });
  const webhooksRouter = createWebhooksRoutes({ buildDeps: () => buildWebhooksRouteDeps() });
  const operationsDashboardRouter = createOperationsDashboardRoutes({ buildDeps: () => buildOperationsDashboardRouteDeps() });
  const webScrapingRouter = createWebScrapingRoutes({ buildDeps: () => buildWebScrapingRouteDeps() });
  const qaRouter = createQaRoutes({ buildDeps: () => buildQaRouteDeps() });
  const rpaTestsRouter = createRpaTestsRoutes({ buildDeps: () => buildRpaTestsRouteDeps() });
  const devManagementRouter = createDevManagementRoutes({ buildDeps: () => buildDevManagementRouteDeps() });
  const intelligenceRouter = createIntelligenceRoutes({ buildDeps: () => buildIntelligenceRouteDeps() });
  const marketIntelligenceRouter = createMarketIntelligenceRoutes({ buildDeps: () => buildMarketIntelligenceRouteDeps() });
  const accessControlRouter = createAccessControlRoutes({ buildDeps: () => buildAccessControlRouteDeps() });
  const voiceRouter = createVoiceRoutes({ buildDeps: () => buildVoiceRouteDeps() });
  const analyticsRouter = createAnalyticsRoutes({ buildDeps: () => buildAnalyticsRouteDeps() });
  const bulkCampaignsRouter = createBulkCampaignsRoutes({ buildDeps: () => buildBulkCampaignsRouteDeps() });
  const quickRepliesRouter = createQuickRepliesRoutes({ buildDeps: () => buildQuickRepliesRouteDeps() });
  const queueTicketRouter = createQueueTicketRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  });
  const opsRouter = createOpsRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
      };
    },
  });
  const executionLedgerRouter = createExecutionLedgerRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
      };
    },
  });
  const supportDebugRouter = createSupportDebugRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        sendJson: ctx.sendJson,
        parseJsonBody: ctx.parseJsonBody,
        scheduleService: ctx.scheduleService,
        extractSemanticContext: ctx.extractSemanticContext,
        logger: ctx.logger,
        nlpExtractKeywords: ctx.nlpExtractKeywords,
        nlpAnalyzeText: ctx.nlpAnalyzeText,
      };
    },
  });
  const publicApiRouter = createPublicApiRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        checkRateLimit: ctx.checkRateLimit,
      };
    },
  });
  const channelWebhookRouter = createChannelWebhookRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        verifyWebhook: ctx.verifyWebhook,
        processWhatsAppMessage: ctx.processWhatsAppMessage,
        verifyMessengerWebhook: ctx.verifyMessengerWebhook,
        sendMessengerMessage: ctx.sendMessengerMessage,
        sendMessengerButtons: ctx.sendMessengerButtons,
        verifyInstagramWebhook: ctx.verifyInstagramWebhook,
        sendInstagramMessage: ctx.sendInstagramMessage,
        sendInstagramMedia: ctx.sendInstagramMedia,
        channelNormalizationService: ctx.channelNormalizationService,
        channelGatewayService: ctx.channelGatewayService,
        resolveOrCreateTicketFromIncomingMessage: ctx.resolveOrCreateTicketFromIncomingMessage,
        appendTicketMessage: ctx.appendTicketMessage,
        autoAssignTicket: ctx.autoAssignTicket,
        emitEvent: ctx.emitEvent,
        flows: ctx.flows,
        sessionEvents: ctx.sessionEvents,
        saveSessionEventsToFile: ctx.saveSessionEventsToFile,
      };
    },
  });
  const whatsAppConnectionRouter = createWhatsAppConnectionRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  });
  const whatsAppIvrRouter = createWhatsAppIvrRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        crypto: ctx.crypto,
      };
    },
  });
  const whatsAppQrWebhookRouter = createWhatsAppQrWebhookRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  });
  const frontendFallbackRouter = createFrontendFallbackRoutes({ buildDeps: () => buildFrontendFallbackDeps() });

  // --- Routers de domínio (via composition) ---
  const ticketRouter = createTicketExpressRouter();

  // --- Rate limit middleware ---
  app.use(tenantRateLimitExpressMiddleware);

  // --- Ordem de montagem (preservada exatamente do server.js original) ---
  app.use(publicSystemRouter);
  app.use(authRouter);
  app.use('/tenants', createTenantExpressRouter());
  app.use(domainAdminRouter);
  app.use(domainIdentityRouter);
  app.use(domainFlowRouter);
  app.use(ticketRouter);
  app.use(verticalRouter);
  app.use(pbxRouter);
  app.use(webhooksRouter);
  app.use(operationsDashboardRouter);
  app.use(webScrapingRouter);
  app.use(qaRouter);
  app.use(rpaTestsRouter);
  app.use(devManagementRouter);
  app.use(intelligenceRouter);
  app.use(marketIntelligenceRouter);
  app.use(accessControlRouter);
  app.use(voiceRouter);
  app.use(analyticsRouter);
  app.use(bulkCampaignsRouter);
  app.use(quickRepliesRouter);
  app.use(platformAdminRouter);
  app.use(platformContentRouter);
  app.use(platformPublicRouter);
  app.use(queueTicketRouter);
  app.use(opsRouter);
  app.use(executionLedgerRouter);
  app.use(supportDebugRouter);
  app.use(publicApiRouter);
  app.use(channelWebhookRouter);
  app.use(whatsAppConnectionRouter);
  app.use(whatsAppIvrRouter);
  app.use(whatsAppQrWebhookRouter);
  app.use(domainOperationsRouter);
  app.use(domainBusinessRouter);
  app.use(frontendFallbackRouter);

  // --- Error handlers ---
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
      badRequest(res, 'JSON inválido no corpo da requisição');
      return;
    }
    logger.error('[Server] Erro não tratado na pipeline Express', err);
    sendJson(res, 500, { error: 'internal_error', message: 'Erro interno do servidor' });
  });

  app.use((req, res) => {
    notFound(res);
  });

  app.use((err, req, res, next) => {
    if (res.writableEnded) return;
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad_request', message: 'JSON inválido no corpo da requisição' });
      return;
    }
    res.status(500).json({ error: 'internal_error', message: err?.message || 'Erro interno' });
  });
}

module.exports = { registerRoutes };

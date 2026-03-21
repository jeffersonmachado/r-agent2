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

// --- Middleware ---
const { tenantRateLimitMiddleware } = require('../middleware/tenantRateLimit');
const { createTenantRateLimitMiddleware } = require('../middleware/createTenantRateLimitMiddleware');

// --- HTTP helpers ---
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  notFound,
} = require('../express/httpHelpers');


// --- Composition: domínios ---
const { createTenantExpressRouter } = require('../composition/tenant');
const { createTicketExpressRouter } = require('../composition/ticket');
const { createAuthExpressRouter } = require('../composition/auth');
const { createPbxExpressRouter } = require('../composition/pbx');
const { createOperationsDashboardExpressRouter } = require('../composition/operations-dashboard');
const { createPublicSystemExpressRouter } = require('../composition/public-system');
const { createQaExpressRouter } = require('../composition/qa');
const { createRpaTestsExpressRouter } = require('../composition/rpa-tests');
const { createDevManagementExpressRouter } = require('../composition/dev-management');
const { createIntelligenceExpressRouter } = require('../composition/intelligence');
const { createMarketIntelligenceExpressRouter } = require('../composition/market-intelligence');
const { createAccessControlExpressRouter } = require('../composition/access-control');
const { createAnalyticsExpressRouter } = require('../composition/analytics');
const { createBulkCampaignsExpressRouter } = require('../composition/bulk-campaigns');
const { createQuickRepliesExpressRouter } = require('../composition/quick-replies');
const { createVerticalExpressRouter } = require('../composition/vertical');
const { createWebScrapingExpressRouter } = require('../composition/web-scraping');
const { createWebhooksExpressRouter } = require('../composition/webhooks');
const { createVoiceExpressRouter } = require('../composition/voice');

// --- Routers: módulos ---
const { createFrontendFallbackRoutes } = require('../modules/frontend-fallback/routes');
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

// ---------------------------------------------------------------------------
// Builders de dependências (domínios sem composition própria ainda)
// ---------------------------------------------------------------------------

function buildFrontendFallbackDeps() {
  return { fs, path, logger };
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
  const publicSystemRouter = createPublicSystemExpressRouter();
  const authRouter = createAuthExpressRouter();
  const pbxRouter = createPbxExpressRouter();
  const verticalRouter = createVerticalExpressRouter();
  const webhooksRouter = createWebhooksExpressRouter();
  const operationsDashboardRouter = createOperationsDashboardExpressRouter();
  const webScrapingRouter = createWebScrapingExpressRouter();
  const qaRouter = createQaExpressRouter();
  const rpaTestsRouter = createRpaTestsExpressRouter();
  const devManagementRouter = createDevManagementExpressRouter();
  const intelligenceRouter = createIntelligenceExpressRouter();
  const marketIntelligenceRouter = createMarketIntelligenceExpressRouter();
  const accessControlRouter = createAccessControlExpressRouter();
  const voiceRouter = createVoiceExpressRouter();
  const analyticsRouter = createAnalyticsExpressRouter();
  const bulkCampaignsRouter = createBulkCampaignsExpressRouter();
  const quickRepliesRouter = createQuickRepliesExpressRouter();
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

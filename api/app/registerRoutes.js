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
const { createQaWavesExpressRouter } = require('../composition/qa-waves');
const { createQaMeshExpressRouter } = require('../composition/qa-mesh');
const { createDemoExpressRouter } = require('../composition/demo');
const createOperationalStatusRoutes = require('../routes/operationalStatusRoutes');
const { createRpaTestsExpressRouter } = require('../composition/rpa-tests');
const { createTestExecutionsExpressRouter } = require('../composition/test-executions');
const { createDevManagementExpressRouter } = require('../composition/dev-management');
const { createIntelligenceExpressRouter } = require('../composition/intelligence');
const { createMarketIntelligenceExpressRouter } = require('../composition/market-intelligence');
const { createAccessControlExpressRouter } = require('../composition/access-control');
const { createAnalyticsExpressRouter } = require('../composition/analytics');
const { createBulkCampaignsExpressRouter } = require('../composition/bulk-campaigns');
const { createDomainAdminExpressRouter } = require('../composition/domain-admin');
const { createDomainIdentityExpressRouter } = require('../composition/domain-identity');
const { createDomainFlowExpressRouter } = require('../composition/domain-flow');
const { createQuickRepliesExpressRouter } = require('../composition/quick-replies');
const { createPlatformAdminExpressRouter } = require('../composition/platform-admin');
const { createPlatformContentExpressRouter } = require('../composition/platform-content');
const { createPlatformPublicExpressRouter } = require('../composition/platform-public');
const { createVerticalExpressRouter } = require('../composition/vertical');
const { createBillingExpressRouter } = require('../composition/billing');
const { createWebScrapingExpressRouter } = require('../composition/web-scraping');
const { createWebhooksExpressRouter } = require('../composition/webhooks');
const { createVoiceExpressRouter } = require('../composition/voice');
const { createWorkspaceExpressRouter } = require('../composition/workspace');

const { createDomainOperationsRoutes } = require('../modules/domain-operations/routes');
const { createDomainBusinessRoutes } = require('../modules/domain-business/routes');
const { createCrmRoutes } = require('../modules/crm/routes');
const { createQueueTicketExpressRouter } = require('../composition/queue-ticket');
const { createOpsExpressRouter } = require('../composition/ops');
const { createExecutionLedgerExpressRouter } = require('../composition/execution-ledger');
const { createSupportDebugExpressRouter } = require('../composition/support-debug');
const { createEvidenceExpressRouter } = require('../composition/evidence');
const { createPublicApiExpressRouter } = require('../composition/public-api');
const { createChannelWebhookExpressRouter } = require('../composition/channel-webhook');
const { createWhatsAppConnectionExpressRouter } = require('../composition/whatsapp-connection');
const { createWhatsAppIvrExpressRouter } = require('../composition/whatsapp-ivr');
const { createWhatsAppQrWebhookExpressRouter } = require('../composition/whatsapp-qr-webhook');
const { createFrontendFallbackExpressRouter } = require('../composition/frontend-fallback');
const { createAgentOsExpressRouter } = require('../composition/agent-os');
const { createLearningCoreExpressRouter } = require('../composition/learning-core');
const { createCognitiveExpressRouter } = require('../composition/cognitive');
const { createRouteRegistry } = require('./routeRegistry');

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
  const crmRouter = createCrmRoutes({ buildDeps: buildExtendedRoutingContext });
  const domainAdminRouter = createDomainAdminExpressRouter({ buildCoreRoutingContext });
  const domainIdentityRouter = createDomainIdentityExpressRouter({ buildCoreRoutingContext });
  const domainFlowRouter = createDomainFlowExpressRouter({ buildCoreRoutingContext });
  const platformAdminRouter = createPlatformAdminExpressRouter({ buildPlatformRoutingContext });
  const platformContentRouter = createPlatformContentExpressRouter({ buildPlatformRoutingContext });
  const platformPublicRouter = createPlatformPublicExpressRouter({ buildPlatformRoutingContext });

  // --- Routers modulares ---
  const publicSystemRouter = createPublicSystemExpressRouter();
  const authRouter = createAuthExpressRouter();
  const pbxRouter = createPbxExpressRouter();
  const verticalRouter = createVerticalExpressRouter();
  const billingRouter = createBillingExpressRouter();
  const webhooksRouter = createWebhooksExpressRouter();
  const operationsDashboardRouter = createOperationsDashboardExpressRouter();
  const webScrapingRouter = createWebScrapingExpressRouter();
  const qaRouter = createQaExpressRouter();
  const qaWavesRouter = createQaWavesExpressRouter();
  const qaMeshRouter = createQaMeshExpressRouter();
  const demoRouter = createDemoExpressRouter();
  const operationalStatusRouter = createOperationalStatusRoutes();
  const rpaTestsRouter = createRpaTestsExpressRouter();
  const testExecutionsRouter = createTestExecutionsExpressRouter();
  const devManagementRouter = createDevManagementExpressRouter();
  const intelligenceRouter = createIntelligenceExpressRouter();
  const marketIntelligenceRouter = createMarketIntelligenceExpressRouter();
  const accessControlRouter = createAccessControlExpressRouter();
  const voiceRouter = createVoiceExpressRouter();
  const workspaceRouter = createWorkspaceExpressRouter();
  const analyticsRouter = createAnalyticsExpressRouter();
  const bulkCampaignsRouter = createBulkCampaignsExpressRouter();
  const quickRepliesRouter = createQuickRepliesExpressRouter();
  const queueTicketRouter = createQueueTicketExpressRouter({ buildExtendedRoutingContext });
  const opsRouter = createOpsExpressRouter({ buildExtendedRoutingContext });
  const executionLedgerRouter = createExecutionLedgerExpressRouter({ buildExtendedRoutingContext });
  const evidenceRouter = createEvidenceExpressRouter();
  const supportDebugRouter = createSupportDebugExpressRouter({ buildExtendedRoutingContext });
  const publicApiRouter = createPublicApiExpressRouter({ buildExtendedRoutingContext });
  const channelWebhookRouter = createChannelWebhookExpressRouter({ buildExtendedRoutingContext });
  const whatsAppConnectionRouter = createWhatsAppConnectionExpressRouter({ buildExtendedRoutingContext });
  const whatsAppIvrRouter = createWhatsAppIvrExpressRouter({ buildExtendedRoutingContext });
  const whatsAppQrWebhookRouter = createWhatsAppQrWebhookExpressRouter({ buildExtendedRoutingContext });
  const frontendFallbackRouter = createFrontendFallbackExpressRouter();
  const agentOsRouter = createAgentOsExpressRouter({ buildCoreRoutingContext });
  const cognitiveRouter = createCognitiveExpressRouter({ buildCoreRoutingContext });
  const learningCoreRouter = createLearningCoreExpressRouter({ buildCoreRoutingContext });

  // --- Routers de domínio (via composition) ---
  const ticketRouter = createTicketExpressRouter();
  const tenantRouter = createTenantExpressRouter();

  // --- Rate limit middleware ---
  app.use(tenantRateLimitExpressMiddleware);

  // --- Ordem de montagem (preservada exatamente do server.js original) ---
  // Rastreabilidade histórica de ordem:
  // app.use(domainAdminRouter)
  // app.use(domainIdentityRouter)
  // app.use(domainFlowRouter)
  // app.use(domainOperationsRouter)
  // app.use(domainBusinessRouter)
  // app.use(platformAdminRouter)
  // app.use(platformContentRouter)
  // app.use(platformPublicRouter)
  const routeRegistry = createRouteRegistry({
    publicSystemRouter,
    authRouter,
    tenantRouter,
    domainAdminRouter,
    domainIdentityRouter,
    domainFlowRouter,
    ticketRouter,
    verticalRouter,
    billingRouter,
    pbxRouter,
    webhooksRouter,
    operationsDashboardRouter,
    webScrapingRouter,
    qaRouter,
    qaWavesRouter,
    qaMeshRouter,
    demoRouter,
    operationalStatusRouter,
    rpaTestsRouter,
    testExecutionsRouter,
    devManagementRouter,
    intelligenceRouter,
    marketIntelligenceRouter,
    accessControlRouter,
    voiceRouter,
    workspaceRouter,
    analyticsRouter,
    bulkCampaignsRouter,
    quickRepliesRouter,
    platformAdminRouter,
    platformContentRouter,
    platformPublicRouter,
    queueTicketRouter,
    opsRouter,
    executionLedgerRouter,
    evidenceRouter,
    supportDebugRouter,
    publicApiRouter,
    channelWebhookRouter,
    whatsAppConnectionRouter,
    whatsAppIvrRouter,
    whatsAppQrWebhookRouter,
    domainOperationsRouter,
    domainBusinessRouter,
    crmRouter,
    frontendFallbackRouter,
    agentOsRouter,
    cognitiveRouter,
    learningCoreRouter,
  });

  for (const entry of routeRegistry) {
    if (entry.path) {
      app.use(entry.path, entry.router);
      continue;
    }
    app.use(entry.router);
  }

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
}

module.exports = { registerRoutes };

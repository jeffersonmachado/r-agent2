'use strict';

function createRouteRegistry(routers) {
  return [
    { router: routers.publicSystemRouter },
    { router: routers.authRouter },
    { path: '/tenants', router: routers.tenantRouter },
    { router: routers.domainAdminRouter },
    { router: routers.domainIdentityRouter },
    { router: routers.domainFlowRouter },
    { router: routers.ticketRouter },
    { router: routers.verticalRouter },
    { router: routers.billingRouter },
    { router: routers.pbxRouter },
    { router: routers.webhooksRouter },
    { router: routers.operationsDashboardRouter },
    { router: routers.taskRouter },
    { router: routers.webScrapingRouter },
    { router: routers.qaRouter },
    { router: routers.qaWavesRouter },
    { router: routers.qaMeshRouter },
    { router: routers.engineeringRouterRouter },
    // §B1/§B2: pesquisa competitiva de benchmarks (DEVELOPMENT). Montado aqui
    // porque router fora desta lista simplesmente NÃO é montado.
    { router: routers.benchmarkResearchRouter },
    // T-MR1: descoberta autônoma de mercado (DEVELOPMENT/SYSTEM). Montado aqui
    // porque router fora desta lista simplesmente NÃO é montado.
    { router: routers.marketDiscoveryRouter },
    // MCP Control Plane (§M13): administração das conexões MCP externas.
    // Estava passado em `registerRoutes` mas AUSENTE desta lista — as rotas
    // existiam e nunca eram montadas (superfície morta).
    { router: routers.mcpRouter },
    { router: routers.demoRouter },
    { path: '/qa', router: routers.operationalStatusRouter },
    { router: routers.rpaTestsRouter },
    { router: routers.testExecutionsRouter },
    { router: routers.devManagementRouter },
    { router: routers.intelligenceRouter },
    { router: routers.marketIntelligenceRouter },
    { router: routers.accessControlRouter },
    { router: routers.voiceRouter },
    { router: routers.workspaceRouter },
    { router: routers.agentOsRouter },
    { router: routers.cognitiveRouter },
    { router: routers.learningCoreRouter },
    { router: routers.analyticsRouter },
    // Product Metrics (P4.13). O router JÁ era instanciado em registerRoutes,
    // mas ficava fora desta lista — e router fora da lista NÃO é montado.
    // Efeito real (2026-09-13, Page Surface Wave em /analytics):
    // GET /api/product-metrics/summary → 404 e a seção de métricas do produto
    // não carregava. Regressão coberta por tests/unit/routeRegistryMount.test.js.
    { router: routers.productMetricsRouter },
    // Web Push (public-key/subscribe/unsubscribe). Mesmo defeito de montagem:
    // instanciado em registerRoutes, ausente desta lista ⇒ /api/push/* 404 e o
    // frontend (frontend/src/api/webPush.js) sem conseguir assinar push.
    { router: routers.pushRouter },
    { router: routers.bulkCampaignsRouter },
    { router: routers.quickRepliesRouter },
    { router: routers.platformAdminRouter },
    { router: routers.platformContentRouter },
    { router: routers.platformPublicRouter },
    { router: routers.queueTicketRouter },
    { router: routers.orderRouter },
    { router: routers.opsRouter },
    { router: routers.executionLedgerRouter },
    { router: routers.evidenceRouter },
    { router: routers.supportDebugRouter },
    { router: routers.publicApiRouter },
    { router: routers.channelWebhookRouter },
    { router: routers.integrationRouter },
    { router: routers.whatsAppConnectionRouter },
    { router: routers.whatsAppIvrRouter },
    { router: routers.whatsAppQrWebhookRouter },
    { router: routers.domainOperationsRouter },
    { router: routers.domainBusinessRouter },
    { router: routers.crmRouter },
    { router: routers.tenantCapabilitiesRouter },
    { router: routers.casesRouter },
    { router: routers.frontendFallbackRouter },
  ];
}

module.exports = {
  createRouteRegistry,
};

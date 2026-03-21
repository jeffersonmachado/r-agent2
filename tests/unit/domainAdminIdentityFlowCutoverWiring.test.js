/**
 * tests/unit/domainAdminIdentityFlowCutoverWiring.test.js
 *
 * Testes de wiring para verificar que os routers de domínio (admin, identity, flow)
 * foram properly extraídos de core-residual e montados em registerRoutes.
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Domain Admin, Identity, and Flow Router Wiring', () => {
  describe('Domain Admin Router', () => {
    test('should export createDomainAdminRoutes factory', () => {
      jest.resetModules();
      const { createDomainAdminRoutes } = require('../../api/modules/domain-admin/routes');
      expect(typeof createDomainAdminRoutes).toBe('function');
    });

    test('should mount all required admin sub-handlers', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-admin', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Check that all admin handlers are mounted
      expect(source).toContain('handleSystemAdminRoutes');
      expect(source).toContain('handleSystemGenerationRoutes');
      expect(source).toContain('handleSuperAdminRoutes');
      expect(source).toContain('handleOnboardingRoutes');

      // Verify local handler mounting without shared bridge
      expect(source).toContain('handleSystemAdminRoutes');
      expect(source).toContain('handleSystemGenerationRoutes');
      expect(source).not.toContain('mountExpressHandler');
    });
  });

  describe('Domain Identity Router', () => {
    test('should export createDomainIdentityRoutes factory', () => {
      jest.resetModules();
      const { createDomainIdentityRoutes } = require('../../api/modules/domain-identity/routes');
      expect(typeof createDomainIdentityRoutes).toBe('function');
    });

    test('should mount all required identity sub-handlers', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-identity', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Check that identity handlers are mounted
      expect(source).toContain('handleAgentRoutes');
      expect(source).toContain('handleAuditRoutes');

      // Verify local handler mounting without shared bridge
      expect(source).toContain('handleAgentRoutes');
      expect(source).toContain('handleAuditRoutes');
      expect(source).not.toContain('createExpressHandlerMiddleware');
    });
  });

  describe('Domain Flow Router', () => {
    test('should export createDomainFlowRoutes factory', () => {
      jest.resetModules();
      const { createDomainFlowRoutes } = require('../../api/modules/domain-flow/routes');
      expect(typeof createDomainFlowRoutes).toBe('function');
    });

    test('should mount all required flow sub-handlers', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-flow', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Check that flow handlers are mounted
      expect(source).toContain('handleFlowCrudRoutes');
      expect(source).toContain('handleFlowExecutionRoutes');
      expect(source).toContain('handleConversationRoutes');

      // Verify local handler mounting without shared bridge
      expect(source).toContain('handleFlowCrudRoutes');
      expect(source).toContain('handleFlowExecutionRoutes');
      expect(source).not.toContain('createExpressHandlerMiddleware');
    });
  });

  describe('Core-Residual Elimination', () => {
    test('should not have core-residual module imported in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).not.toContain('createCoreResidualRoutes');
      expect(content).not.toContain("require('../modules/core-residual/routes')");
    });

    test('should have domain admin router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainAdminExpressRouter');
      expect(content).toContain("require('../composition/domain-admin')");
      expect(content).toContain('domainAdminRouter');
      expect(content).toContain('app.use(domainAdminRouter)');
    });

    test('should have domain identity router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainIdentityExpressRouter');
      expect(content).toContain("require('../composition/domain-identity')");
      expect(content).toContain('domainIdentityRouter');
      expect(content).toContain('app.use(domainIdentityRouter)');
    });

    test('should have domain flow router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainFlowExpressRouter');
      expect(content).toContain("require('../composition/domain-flow')");
      expect(content).toContain('domainFlowRouter');
      expect(content).toContain('app.use(domainFlowRouter)');
    });

    test('should have deleted core-residual directory', () => {
      const coreResidualPath = path.join(process.cwd(), 'api', 'modules', 'core-residual');
      expect(fs.existsSync(coreResidualPath)).toBe(false);
    });

    test('should have proper router mounting order preserved', () => {
      jest.resetModules();
      const { createRouteRegistry } = require('../../api/app/routeRegistry');
      const registry = createRouteRegistry({
        publicSystemRouter: 'publicSystemRouter',
        authRouter: 'authRouter',
        tenantRouter: 'tenantRouter',
        domainAdminRouter: 'domainAdminRouter',
        domainIdentityRouter: 'domainIdentityRouter',
        domainFlowRouter: 'domainFlowRouter',
        ticketRouter: 'ticketRouter',
        verticalRouter: 'verticalRouter',
        pbxRouter: 'pbxRouter',
        webhooksRouter: 'webhooksRouter',
        operationsDashboardRouter: 'operationsDashboardRouter',
        webScrapingRouter: 'webScrapingRouter',
        qaRouter: 'qaRouter',
        rpaTestsRouter: 'rpaTestsRouter',
        devManagementRouter: 'devManagementRouter',
        intelligenceRouter: 'intelligenceRouter',
        marketIntelligenceRouter: 'marketIntelligenceRouter',
        accessControlRouter: 'accessControlRouter',
        voiceRouter: 'voiceRouter',
        analyticsRouter: 'analyticsRouter',
        bulkCampaignsRouter: 'bulkCampaignsRouter',
        quickRepliesRouter: 'quickRepliesRouter',
        platformAdminRouter: 'platformAdminRouter',
        platformContentRouter: 'platformContentRouter',
        platformPublicRouter: 'platformPublicRouter',
        queueTicketRouter: 'queueTicketRouter',
        opsRouter: 'opsRouter',
        executionLedgerRouter: 'executionLedgerRouter',
        supportDebugRouter: 'supportDebugRouter',
        publicApiRouter: 'publicApiRouter',
        channelWebhookRouter: 'channelWebhookRouter',
        whatsAppConnectionRouter: 'whatsAppConnectionRouter',
        whatsAppIvrRouter: 'whatsAppIvrRouter',
        whatsAppQrWebhookRouter: 'whatsAppQrWebhookRouter',
        domainOperationsRouter: 'domainOperationsRouter',
        domainBusinessRouter: 'domainBusinessRouter',
        frontendFallbackRouter: 'frontendFallbackRouter',
      });

      const routers = registry.map((entry) => entry.router);
      const publicSystemIndex = routers.indexOf('publicSystemRouter');
      const authIndex = routers.indexOf('authRouter');
      const domainAdminIndex = routers.indexOf('domainAdminRouter');
      const domainIdentityIndex = routers.indexOf('domainIdentityRouter');
      const domainFlowIndex = routers.indexOf('domainFlowRouter');
      const ticketIndex = routers.indexOf('ticketRouter');

      expect(publicSystemIndex).toBeGreaterThanOrEqual(0);
      expect(authIndex).toBeGreaterThan(publicSystemIndex);
      expect(domainAdminIndex).toBeGreaterThan(authIndex);
      expect(domainIdentityIndex).toBeGreaterThan(domainAdminIndex);
      expect(domainFlowIndex).toBeGreaterThan(domainIdentityIndex);
      expect(ticketIndex).toBeGreaterThan(domainFlowIndex);
    });
  });
});

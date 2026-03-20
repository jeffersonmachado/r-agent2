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

      // Verify mount points
      expect(source).toContain('mountExpressHandler(router');
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

      // Verify mount points
      expect(source).toContain('mountExpressHandler(router');
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

      // Verify mount points
      expect(source).toContain('mountExpressHandler(router');
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

      expect(content).toContain('createDomainAdminRoutes');
      expect(content).toContain("require('../modules/domain-admin/routes')");
      expect(content).toContain('domainAdminRouter');
      expect(content).toContain('app.use(domainAdminRouter)');
    });

    test('should have domain identity router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainIdentityRoutes');
      expect(content).toContain("require('../modules/domain-identity/routes')");
      expect(content).toContain('domainIdentityRouter');
      expect(content).toContain('app.use(domainIdentityRouter)');
    });

    test('should have domain flow router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainFlowRoutes');
      expect(content).toContain("require('../modules/domain-flow/routes')");
      expect(content).toContain('domainFlowRouter');
      expect(content).toContain('app.use(domainFlowRouter)');
    });

    test('should have deleted core-residual directory', () => {
      const coreResidualPath = path.join(process.cwd(), 'api', 'modules', 'core-residual');
      expect(fs.existsSync(coreResidualPath)).toBe(false);
    });

    test('should have proper router mounting order preserved', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      // Find indices of router mounting
      const publicSystemIndex = content.indexOf('app.use(publicSystemRouter)');
      const authIndex = content.indexOf('app.use(authRouter)');
      const domainAdminIndex = content.indexOf('app.use(domainAdminRouter)');
      const domainIdentityIndex = content.indexOf('app.use(domainIdentityRouter)');
      const domainFlowIndex = content.indexOf('app.use(domainFlowRouter)');
      const ticketIndex = content.indexOf('app.use(ticketRouter)');

      // Verify order is preserved from original core mounting
      expect(publicSystemIndex).toBeGreaterThan(0);
      expect(authIndex).toBeGreaterThan(publicSystemIndex);
      expect(domainAdminIndex).toBeGreaterThan(authIndex);
      expect(domainIdentityIndex).toBeGreaterThan(domainAdminIndex);
      expect(domainFlowIndex).toBeGreaterThan(domainIdentityIndex);
      expect(ticketIndex).toBeGreaterThan(domainFlowIndex);
    });
  });
});

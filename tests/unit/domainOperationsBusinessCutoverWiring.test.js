/**
 * tests/unit/domainOperationsBusinessCutoverWiring.test.js
 *
 * Testes de wiring para verificar que os routers de domínio (operations e business)
 * foram properly extraídos de extended-residual e montados em registerRoutes.
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Domain Operations and Business Router Wiring', () => {
  describe('Domain Operations Router', () => {
    test('should export createDomainOperationsRoutes factory', () => {
      jest.resetModules();
      const { createDomainOperationsRoutes } = require('../../api/modules/domain-operations/routes');
      expect(typeof createDomainOperationsRoutes).toBe('function');
    });

    test('should mount all required sub-routers in domain operations', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-operations', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Check that task router is mounted
      expect(source).toContain("require('../task/routes')");
      expect(source).toContain('createTaskRoutes');
      expect(source).toContain('router.use(createTaskRoutes');

      // Check that scheduling-support router is mounted
      expect(source).toContain("require('../scheduling-support/routes')");
      expect(source).toContain('createSchedulingSupportRoutes');

      // Check that inbox router is mounted
      expect(source).toContain("require('../inbox/routes')");
      expect(source).toContain('createInboxRoutes');

      // Check that supervisor router is mounted
      expect(source).toContain("require('../supervisor/routes')");
      expect(source).toContain('createSupervisorRoutes');
    });

    test('should ensure buildDeps is used correctly for each sub-router', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-operations', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Count occurrences of buildDeps usage
      const buildDepsMatches = source.match(/buildDeps\(/g);
      expect(buildDepsMatches).toBeDefined();
      expect(buildDepsMatches.length).toBeGreaterThan(3); // At least 4 sub-routers
    });
  });

  describe('Domain Business Router', () => {
    test('should export createDomainBusinessRoutes factory', () => {
      jest.resetModules();
      const { createDomainBusinessRoutes } = require('../../api/modules/domain-business/routes');
      expect(typeof createDomainBusinessRoutes).toBe('function');
    });

    test('should mount all required sub-routers in domain business', () => {
      const routesPath = path.join(process.cwd(), 'api', 'modules', 'domain-business', 'routes.js');
      const source = fs.readFileSync(routesPath, 'utf8');

      // Check that all business sub-routers are required and mounted
      const requiredRouters = [
        'rag-documents',
        'rbac',
        'process-runtime',
        'marketing',
        'order',
        'automation',
        'developer-key',
        'solution',
        'sla',
      ];

      requiredRouters.forEach(routerName => {
        expect(source).toContain(`require('../${routerName}/routes')`);
      });

      // Verify mount points exist
      expect(source).toContain('router.use(createRagDocumentsRoutes');
      expect(source).toContain('router.use(createRbacRoutes');
      expect(source).toContain('router.use(createProcessRuntimeRoutes');
    });
  });

  describe('Extended-Residual Elimination', () => {
    test('should not have extended-residual module imported in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).not.toContain('createExtendedResidualRoutes');
      expect(content).not.toContain("require('../modules/extended-residual/routes')");
    });

    test('should have domain operations router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainOperationsRoutes');
      expect(content).toContain("require('../modules/domain-operations/routes')");
      expect(content).toContain('domainOperationsRouter');
      expect(content).toContain('app.use(domainOperationsRouter)');
    });

    test('should have domain business router in registerRoutes', () => {
      const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
      const content = fs.readFileSync(registerRoutesPath, 'utf8');

      expect(content).toContain('createDomainBusinessRoutes');
      expect(content).toContain("require('../modules/domain-business/routes')");
      expect(content).toContain('domainBusinessRouter');
      expect(content).toContain('app.use(domainBusinessRouter)');
    });

    test('should have deleted extended-residual directory', () => {
      const extendedResidualPath = path.join(process.cwd(), 'api', 'modules', 'extended-residual');
      expect(fs.existsSync(extendedResidualPath)).toBe(false);
    });
  });
});

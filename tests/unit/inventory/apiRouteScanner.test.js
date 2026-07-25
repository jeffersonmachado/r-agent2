'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanApiRoutes, classifyModule } = require('../../../api/services/qa/inventory/apiRouteScanner');

function writeFixture(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-api-'));

  writeFixture(rootDir, 'api/app/routeRegistry.js', `'use strict';
function createRouteRegistry(routers) {
  return [
    { router: routers.appointmentsRouter },
    { path: '/qa', router: routers.qaWavesRouter },
  ];
}
module.exports = { createRouteRegistry };
`);

  writeFixture(rootDir, 'api/app/registerRoutes.js', `'use strict';
const { createAppointmentsRoutes } = require('../modules/appointments/routes');
const { createQaWavesRoutes } = require('../modules/qa-waves/routes');
const { createRouteRegistry } = require('./routeRegistry');
function registerRoutes() {
  const appointmentsRouter = createAppointmentsRoutes();
  const qaWavesRouter = createQaWavesRoutes();
  return createRouteRegistry({ appointmentsRouter, qaWavesRouter });
}
module.exports = { registerRoutes };
`);

  writeFixture(rootDir, 'api/modules/appointments/routes.js', `'use strict';
const express = require('express');
function createAppointmentsRoutes() {
  const router = express.Router();
  router.get('/api/appointments', requireAuth, requirePermission('agenda', 'read'), async (req, res) => {});
  router.post('/api/appointments', requireAuth, async (req, res) => {});
  router.get(['/api/appointments/report', '/api/appointments/export'], validateTenant, async (req, res) => {});
  return router;
}
module.exports = { createAppointmentsRoutes };
`);

  writeFixture(rootDir, 'api/modules/qa-waves/routes.js', `'use strict';
const express = require('express');
function createQaWavesRoutes({ buildDeps }) {
  const router = express.Router();
  function registerJsonPost(pathname, handler) {
    router.post(pathname, async (req, res) => {
      const deps = buildDeps(req, res);
      const auth = deps.requireAuth(req);
      if (!auth.valid) return;
      await handler(deps, req, res);
    });
  }
  registerJsonPost('/infer-scenario', async (deps, req, res) => {});
  return router;
}
module.exports = { createQaWavesRoutes };
`);

  return rootDir;
}

describe('apiRouteScanner', () => {
  let rootDir;
  let result;

  beforeAll(() => {
    rootDir = createFixtureRoot();
    result = scanApiRoutes({ rootDir });
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('descobre GET e POST na mesma URL como itens distintos', () => {
    const get = result.items.find((item) => item.id === 'api:GET:/api/appointments');
    const post = result.items.find((item) => item.id === 'api:POST:/api/appointments');
    expect(get).toBeDefined();
    expect(post).toBeDefined();
    expect(get.method).toBe('GET');
    expect(post.method).toBe('POST');
  });

  it('detecta middlewares de autenticação e autorização na cadeia', () => {
    const get = result.items.find((item) => item.id === 'api:GET:/api/appointments');
    expect(get.authRequired).toBe(true);
    expect(get.authorization).toContain('requirePermission:agenda:read');
    expect(get.module).toBe('appointments');
    expect(get.source).toBe(path.join('api', 'modules', 'appointments', 'routes.js'));
  });

  it('expande paths registrados como array de literais', () => {
    expect(result.items.some((item) => item.id === 'api:GET:/api/appointments/report')).toBe(true);
    expect(result.items.some((item) => item.id === 'api:GET:/api/appointments/export')).toBe(true);
  });

  it('aplica o prefixo de montagem e resolve helpers registerJson*', () => {
    const helper = result.items.find((item) => item.id === 'api:POST:/qa/infer-scenario');
    expect(helper).toBeDefined();
    expect(helper.authRequired).toBe(true); // deps.requireAuth dentro do helper
    expect(helper.classification).toBe('DEVELOPMENT');
    expect(helper.module).toBe('qa-waves');
  });

  it('classifica módulos pela regra documentada', () => {
    expect(classifyModule('qa-waves')).toBe('DEVELOPMENT');
    expect(classifyModule('qa-mesh')).toBe('DEVELOPMENT');
    expect(classifyModule('rpa-tests')).toBe('DEVELOPMENT');
    expect(classifyModule('dev-management')).toBe('DEVELOPMENT');
    expect(classifyModule('support-debug')).toBe('SUPPORT');
    expect(classifyModule('execution-ledger')).toBe('SUPPORT');
    expect(classifyModule('crm')).toBe('PRODUCTION');
  });
});

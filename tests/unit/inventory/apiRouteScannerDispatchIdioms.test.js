'use strict';

/**
 * Regressão do scanner de rotas (inventário): idiomas de dispatch manual que
 * deixavam endpoints reais fora do inventário.
 *
 * Falha observada (sondagem 2026-07-27): /rag/documents*, /api/tenant-settings/:key,
 * /api/backup/export|import, GET/PUT/DELETE /flows/:id, PUT /flows/:id/environment,
 * GET /replay/:sessionId, GET /storefront/orders/:id e PUT/DELETE /auth/agents/:id
 * funcionavam em produção mas não eram descobertos — apareciam como lacuna de
 * cobertura no coverage gate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanApiRoutes } = require('../../../api/services/qa/inventory/apiRouteScanner');

function writeFixture(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-idioms-'));

  writeFixture(rootDir, 'api/app/routeRegistry.js', `'use strict';
function createRouteRegistry(routers) {
  return [
    { router: routers.dispatchRouter },
  ];
}
module.exports = { createRouteRegistry };
`);

  writeFixture(rootDir, 'api/app/registerRoutes.js', `'use strict';
const { createDispatchRoutes } = require('../modules/dispatch/routes');
const { createRouteRegistry } = require('./routeRegistry');
function registerRoutes() {
  const dispatchRouter = createDispatchRoutes();
  return createRouteRegistry({ dispatchRouter });
}
module.exports = { registerRoutes };
`);

  writeFixture(rootDir, 'api/modules/dispatch/routes.js', `'use strict';
const express = require('express');
const { handleHelperRoutes } = require('./handleHelperRoutes');
const { handlePrefixRoutes } = require('./handlePrefixRoutes');
function createDispatchRoutes() {
  const router = express.Router();
  router.use(async (req, res, next) => next());
  return router;
}
module.exports = { createDispatchRoutes };
`);

  // Idioma isRouteMatch/canHandlePrefix (rag-documents) + guarda negada (backup)
  writeFixture(rootDir, 'api/modules/dispatch/handleHelperRoutes.js', `'use strict';
async function handleHelperRoutes({ req, res, method, pathname, deps }) {
  if (isRouteMatch(method, pathname, 'GET', '/rag/documents')) { return true; }
  if (isRouteMatch(method, pathname, 'POST', '/rag/documents')) { return true; }
  if (canHandlePrefix(method, pathname, 'DELETE', '/rag/documents/')) { return true; }
  if (pathname !== '/api/backup/export' && pathname !== '/api/backup/import') { return false; }
  if ((method === 'GET' && pathname !== '/api/backup/export') || (method === 'POST' && pathname !== '/api/backup/import')) { return false; }
  return false;
}
module.exports = { handleHelperRoutes };
`);

  // Idiomas startsWith (flows, tenant-settings, storefront)
  writeFixture(rootDir, 'api/modules/dispatch/handlePrefixRoutes.js', `'use strict';
async function handlePrefixRoutes({ req, res, method, pathname, deps }) {
  if (method === 'GET' && pathname.startsWith('/storefront/orders/')) { return true; }
  if (method === 'PUT' && pathname.startsWith('/auth/agents/')) { return true; }
  if (method !== 'DELETE' || !pathname.startsWith('/flows/')) { return false; }
  return true;
}
async function handleEnvironmentRoute({ req, res, method, pathname, deps }) {
  if (!(method === 'PUT' && pathname.startsWith('/flows/') && pathname.endsWith('/environment'))) { return false; }
  return true;
}
async function handleReadRoute({ req, res, method, pathname, deps }) {
  if (method === 'GET' && pathname.startsWith('/flows/') && !pathname.endsWith('/environment')) { return true; }
  return false;
}
async function handleTenantSettings({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/api/tenant-settings/')) { return false; }
  if (method !== 'GET' && method !== 'POST') { return false; }
  return true;
}
module.exports = { handlePrefixRoutes };
`);

  return rootDir;
}

describe('apiRouteScanner — idiomas de dispatch manual', () => {
  let rootDir;
  let result;

  beforeAll(() => {
    rootDir = createFixtureRoot();
    result = scanApiRoutes({ rootDir });
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  const has = (id) => result.items.some((item) => item.id === id);

  it('descobre helpers isRouteMatch/canHandlePrefix (rag-documents)', () => {
    expect(has('api:GET:/rag/documents')).toBe(true);
    expect(has('api:POST:/rag/documents')).toBe(true);
    expect(has('api:DELETE:/rag/documents/:id')).toBe(true);
  });

  it('descobre pares método+rota em guarda negada (backup)', () => {
    expect(has('api:GET:/api/backup/export')).toBe(true);
    expect(has('api:POST:/api/backup/import')).toBe(true);
  });

  it('descobre rotas parametrizadas via startsWith', () => {
    expect(has('api:GET:/storefront/orders/:id')).toBe(true);
    expect(has('api:PUT:/auth/agents/:id')).toBe(true);
    expect(has('api:DELETE:/flows/:id')).toBe(true);
  });

  it('não inventa rota a partir de endsWith negado', () => {
    expect(has('api:GET:/flows/:id')).toBe(true);
    expect(has('api:GET:/flows/:id/environment')).toBe(false);
  });

  it('descobre allow-list de métodos em guarda de prefixo (tenant-settings)', () => {
    expect(has('api:GET:/api/tenant-settings/:id')).toBe(true);
    expect(has('api:POST:/api/tenant-settings/:id')).toBe(true);
  });
});

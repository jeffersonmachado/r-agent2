'use strict';

const fs = require('fs');
const path = require('path');

describe('dev-management composition cutover wiring', () => {
  test('registerRoutes delega dev-management para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createDevManagementExpressRouter/);
    expect(source).toMatch(/const devManagementRouter = createDevManagementExpressRouter\(\)/);
    expect(source).not.toMatch(/buildDevManagementRouteDeps/);
  });

  test('composition dev-management injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'dev-management', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createDevManagementRoutes/);
    expect(source).toMatch(/isSuperAdmin/);
    expect(source).toMatch(/logAction/);
    expect(source).toMatch(/parseJsonBody/);
  });
});

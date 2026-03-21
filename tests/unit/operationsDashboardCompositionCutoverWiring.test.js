'use strict';

const fs = require('fs');
const path = require('path');

describe('operations-dashboard composition cutover wiring', () => {
  test('registerRoutes delega operations-dashboard para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createOperationsDashboardExpressRouter/);
    expect(source).toMatch(/const operationsDashboardRouter = createOperationsDashboardExpressRouter\(\)/);
    expect(source).not.toMatch(/buildOperationsDashboardRouteDeps/);
  });

  test('composition operations-dashboard monta router com deps esperadas', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'operations-dashboard', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createOperationsDashboardRoutes/);
    expect(source).toMatch(/requireTenant/);
    expect(source).toMatch(/requirePermission/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('vertical composition cutover wiring', () => {
  test('registerRoutes delega vertical para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createVerticalExpressRouter/);
    expect(source).toMatch(/const verticalRouter = createVerticalExpressRouter\(\)/);
    expect(source).not.toMatch(/buildVerticalRouteDeps/);
  });

  test('composition vertical monta router com deps esperadas', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'vertical', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createVerticalRoutes/);
    expect(source).toMatch(/requireTenant/);
    expect(source).toMatch(/requirePermission/);
    expect(source).toMatch(/logAction/);
  });
});

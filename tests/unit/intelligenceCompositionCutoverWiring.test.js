'use strict';

const fs = require('fs');
const path = require('path');

describe('intelligence composition cutover wiring', () => {
  test('registerRoutes delega intelligence para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createIntelligenceExpressRouter/);
    expect(source).toMatch(/const intelligenceRouter = createIntelligenceExpressRouter\(\)/);
    expect(source).not.toMatch(/buildIntelligenceRouteDeps/);
  });

  test('composition intelligence injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'intelligence', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createIntelligenceRoutes/);
    expect(source).toMatch(/requireTenant/);
    expect(source).toMatch(/requirePermission/);
  });
});

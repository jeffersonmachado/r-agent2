'use strict';

const fs = require('fs');
const path = require('path');

describe('market-intelligence composition cutover wiring', () => {
  test('registerRoutes delega market-intelligence para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createMarketIntelligenceExpressRouter/);
    expect(source).toMatch(/const marketIntelligenceRouter = createMarketIntelligenceExpressRouter\(\)/);
    expect(source).not.toMatch(/buildMarketIntelligenceRouteDeps/);
  });

  test('composition market-intelligence injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'market-intelligence', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createMarketIntelligenceRoutes/);
    expect(source).toMatch(/requireTenant/);
    expect(source).toMatch(/requirePermission/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('market intelligence route wiring', () => {
  test('registerRoutes registra router de market intelligence e o handler permanece presente', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const registerRoutesSource = fs.readFileSync(registerRoutesPath, 'utf8');
    const routerPath = path.join(process.cwd(), 'api', 'modules', 'market-intelligence', 'routes.js');
    const routerSource = fs.readFileSync(routerPath, 'utf8');

    expect(registerRoutesSource).toMatch(/createMarketIntelligenceRoutes/);
    expect(registerRoutesSource).toMatch(/app\.use\(marketIntelligenceRouter\)/);
    expect(routerSource).toMatch(/handleMarketIntelligenceRoutes/);
    expect(routerSource).toMatch(/serverHandlers\/marketIntelligenceRoutes/);
  });
});

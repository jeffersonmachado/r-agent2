'use strict';

const fs = require('fs');
const path = require('path');

describe('intelligence route wiring', () => {
  test('registerRoutes registra router de intelligence e o handler permanece presente', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const registerRoutesSource = fs.readFileSync(registerRoutesPath, 'utf8');
    const routerPath = path.join(process.cwd(), 'api', 'modules', 'intelligence', 'routes.js');
    const routerSource = fs.readFileSync(routerPath, 'utf8');

    expect(registerRoutesSource).toMatch(/createIntelligenceRoutes/);
    expect(registerRoutesSource).toMatch(/app\.use\(intelligenceRouter\)/);
    expect(routerSource).toMatch(/handleIntelligenceRoutes/);
    expect(routerSource).toMatch(/serverHandlers\/intelligenceRoutes/);
  });

  test('server handler expoe endpoint minimo de busca estrategica', () => {
    const handlerPath = path.join(process.cwd(), 'api', 'serverHandlers', 'intelligenceRoutes.js');
    const source = fs.readFileSync(handlerPath, 'utf8');

    expect(source).toMatch(/POST' && pathname === '\/api\/intelligence\/search'/);
  });
});

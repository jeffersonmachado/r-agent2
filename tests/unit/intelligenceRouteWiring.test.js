'use strict';

const fs = require('fs');
const path = require('path');

describe('intelligence route wiring', () => {
  test('registerRoutes registra router de intelligence e o handler local permanece presente', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const registerRoutesSource = fs.readFileSync(registerRoutesPath, 'utf8');
    const routerPath = path.join(process.cwd(), 'api', 'modules', 'intelligence', 'routes.js');
    const routerSource = fs.readFileSync(routerPath, 'utf8');

    expect(registerRoutesSource).toMatch(/createIntelligenceExpressRouter/);
    expect(registerRoutesSource).toMatch(/const intelligenceRouter = createIntelligenceExpressRouter\(\)/);
    expect(routerSource).toMatch(/handleIntelligenceRoutes/);
    expect(routerSource).toMatch(/\.\/handleIntelligenceRoutes/);
    expect(routerSource).not.toMatch(/createExpressHandlerMiddleware/);
  });

  test('router de intelligence nao depende mais do bridge compartilhado', () => {
    const routerPath = path.join(process.cwd(), 'api', 'modules', 'intelligence', 'routes.js');
    const source = fs.readFileSync(routerPath, 'utf8');

    expect(source).not.toMatch(/createExpressHandlerMiddleware/);
    expect(source).not.toMatch(/mountExpressHandler/);
  });
});

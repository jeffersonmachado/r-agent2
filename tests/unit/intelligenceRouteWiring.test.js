'use strict';

const fs = require('fs');
const path = require('path');

describe('intelligence route wiring', () => {
  test('server.js registra handleIntelligenceRoutes no dispatcher', () => {
    const serverPath = path.join(process.cwd(), 'api', 'server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    expect(source).toMatch(/handleIntelligenceRoutes/);
    expect(source).toMatch(/serverHandlers\/intelligenceRoutes/);
    expect(source).toMatch(/handledIntelligence/);
  });

  test('server handler expoe endpoint minimo de busca estrategica', () => {
    const handlerPath = path.join(process.cwd(), 'api', 'serverHandlers', 'intelligenceRoutes.js');
    const source = fs.readFileSync(handlerPath, 'utf8');

    expect(source).toMatch(/POST' && pathname === '\/api\/intelligence\/search'/);
  });
});

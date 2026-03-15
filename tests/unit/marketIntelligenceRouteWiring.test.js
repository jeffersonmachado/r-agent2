'use strict';

const fs = require('fs');
const path = require('path');

describe('market intelligence route wiring', () => {
  test('server.js registra handleMarketIntelligenceRoutes no dispatcher', () => {
    const serverPath = path.join(process.cwd(), 'api', 'server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    expect(source).toMatch(/handleMarketIntelligenceRoutes/);
    expect(source).toMatch(/serverHandlers\/marketIntelligenceRoutes/);
    expect(source).toMatch(/Market Intelligence Layer Routes/);
  });
});

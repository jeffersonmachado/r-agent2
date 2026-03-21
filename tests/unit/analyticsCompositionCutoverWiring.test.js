'use strict';

const fs = require('fs');
const path = require('path');

describe('analytics composition cutover wiring', () => {
  test('registerRoutes delega analytics para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createAnalyticsExpressRouter/);
    expect(source).toMatch(/const analyticsRouter = createAnalyticsExpressRouter\(\)/);
    expect(source).not.toMatch(/buildAnalyticsRouteDeps/);
  });

  test('composition analytics injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'analytics', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createAnalyticsRoutes/);
    expect(source).toMatch(/getAllMetrics/);
    expect(source).toMatch(/getTrendMetrics/);
  });
});

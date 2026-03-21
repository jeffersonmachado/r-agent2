'use strict';

const fs = require('fs');
const path = require('path');

describe('web-scraping composition cutover wiring', () => {
  test('registerRoutes delega web-scraping para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createWebScrapingExpressRouter/);
    expect(source).toMatch(/const webScrapingRouter = createWebScrapingExpressRouter\(\)/);
    expect(source).not.toMatch(/buildWebScrapingRouteDeps/);
  });

  test('composition web-scraping injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'web-scraping', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createWebScrapingRoutes/);
    expect(source).toMatch(/scrapeUrl/);
    expect(source).toMatch(/scrapeUrls/);
    expect(source).toMatch(/requireExecutionId/);
    expect(source).toMatch(/GenerationFailureReasons/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('public-system composition cutover wiring', () => {
  test('registerRoutes delega public-system para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createPublicSystemExpressRouter/);
    expect(source).toMatch(/const publicSystemRouter = createPublicSystemExpressRouter\(\)/);
    expect(source).not.toMatch(/buildPublicSystemRouteDeps/);
  });

  test('composition public-system monta router com deps de runtime publico', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'public-system', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createPublicSystemRoutes/);
    expect(source).toMatch(/checkRateLimit/);
    expect(source).toMatch(/setCorsHeaders/);
    expect(source).toMatch(/config/);
  });
});

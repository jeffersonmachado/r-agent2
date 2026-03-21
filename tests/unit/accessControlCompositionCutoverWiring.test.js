'use strict';

const fs = require('fs');
const path = require('path');

describe('access-control composition cutover wiring', () => {
  test('registerRoutes delega access-control para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createAccessControlExpressRouter/);
    expect(source).toMatch(/const accessControlRouter = createAccessControlExpressRouter\(\)/);
    expect(source).not.toMatch(/buildAccessControlRouteDeps/);
  });

  test('composition access-control injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'access-control', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createAccessControlRoutes/);
    expect(source).toMatch(/requireTenant/);
    expect(source).toMatch(/logAction/);
  });
});

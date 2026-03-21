'use strict';

const fs = require('fs');
const path = require('path');

describe('pbx composition cutover wiring', () => {
  test('registerRoutes delega pbx para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createPbxExpressRouter/);
    expect(source).toMatch(/const pbxRouter = createPbxExpressRouter\(\)/);
    expect(source).not.toMatch(/buildPbxRouteDeps/);
  });

  test('composition pbx injeta deps e usa modulo pbx', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'pbx', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createPbxRoutes/);
    expect(source).toMatch(/parseMultipartFormData/);
    expect(source).toMatch(/buildApiError/);
    expect(source).toMatch(/requireTenant/);
  });
});

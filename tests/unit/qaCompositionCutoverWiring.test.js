'use strict';

const fs = require('fs');
const path = require('path');

describe('qa composition cutover wiring', () => {
  test('registerRoutes delega qa para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createQaExpressRouter/);
    expect(source).toMatch(/const qaRouter = createQaExpressRouter\(\)/);
    expect(source).not.toMatch(/buildQaRouteDeps/);
  });

  test('composition qa monta router e injeta deps esperadas', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'qa', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createQaRoutes/);
    expect(source).toMatch(/getLatestQaResult/);
    expect(source).toMatch(/getQaHistory/);
    expect(source).toMatch(/getQaResultById/);
    expect(source).toMatch(/runQaManual/);
    expect(source).toMatch(/getQaStatistics/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('rpa-tests composition cutover wiring', () => {
  test('registerRoutes delega rpa-tests para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createRpaTestsExpressRouter/);
    expect(source).toMatch(/const rpaTestsRouter = createRpaTestsExpressRouter\(\)/);
    expect(source).not.toMatch(/buildRpaTestsRouteDeps/);
  });

  test('composition rpa-tests injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'rpa-tests', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createRpaTestsRoutes/);
    expect(source).toMatch(/listRecordings/);
    expect(source).toMatch(/executeRecording/);
    expect(source).toMatch(/getExecutionStatus/);
    expect(source).toMatch(/startManualRecording/);
    expect(source).toMatch(/stopManualRecording/);
  });
});

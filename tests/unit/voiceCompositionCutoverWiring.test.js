'use strict';

const fs = require('fs');
const path = require('path');

describe('voice composition cutover wiring', () => {
  test('registerRoutes delega voice para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createVoiceExpressRouter/);
    expect(source).toMatch(/const voiceRouter = createVoiceExpressRouter\(\)/);
    expect(source).not.toMatch(/buildVoiceRouteDeps/);
  });

  test('composition voice monta router com deps esperadas', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'voice', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createVoiceRoutes/);
    expect(source).toMatch(/requirePermission/);
    expect(source).toMatch(/parseJsonBody/);
    expect(source).toMatch(/logger/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('quick-replies composition cutover wiring', () => {
  test('registerRoutes delega quick-replies para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createQuickRepliesExpressRouter/);
    expect(source).toMatch(/const quickRepliesRouter = createQuickRepliesExpressRouter\(\)/);
    expect(source).not.toMatch(/buildQuickRepliesRouteDeps/);
  });

  test('composition quick-replies injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'quick-replies', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createQuickRepliesRoutes/);
    expect(source).toMatch(/listQuickReplies/);
    expect(source).toMatch(/createQuickReply/);
    expect(source).toMatch(/searchByContext/);
  });
});

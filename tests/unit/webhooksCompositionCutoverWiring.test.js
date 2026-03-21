'use strict';

const fs = require('fs');
const path = require('path');

describe('webhooks composition cutover wiring', () => {
  test('registerRoutes delega webhooks para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createWebhooksExpressRouter/);
    expect(source).toMatch(/const webhooksRouter = createWebhooksExpressRouter\(\)/);
    expect(source).not.toMatch(/buildWebhooksRouteDeps/);
  });

  test('composition webhooks monta router de modulo e injeta servicos', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'webhooks', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createWebhooksRoutes/);
    expect(source).toMatch(/createWebhook/);
    expect(source).toMatch(/listWebhooks/);
    expect(source).toMatch(/getWebhook/);
    expect(source).toMatch(/updateWebhook/);
    expect(source).toMatch(/deleteWebhook/);
    expect(source).toMatch(/getAvailableEvents/);
  });
});

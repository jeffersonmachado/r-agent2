'use strict';

const fs = require('fs');
const path = require('path');

describe('extended channel cutover wiring', () => {
  test('registerRoutes monta routers migrados de canais extendidos', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    // Verify composition functions are imported
    expect(source).toMatch(/createPublicApiExpressRouter/);
    expect(source).toMatch(/createChannelWebhookExpressRouter/);
    expect(source).toMatch(/createWhatsAppConnectionExpressRouter/);
    expect(source).toMatch(/createWhatsAppIvrExpressRouter/);
    expect(source).toMatch(/createWhatsAppQrWebhookExpressRouter/);

    // Verify routers are registered in routeRegistry (indirectly mounted via registry loop)
    expect(source).toMatch(/publicApiRouter/);
    expect(source).toMatch(/channelWebhookRouter/);
    expect(source).toMatch(/whatsAppConnectionRouter/);
    expect(source).toMatch(/whatsAppIvrRouter/);
    expect(source).toMatch(/whatsAppQrWebhookRouter/);
  });

  test('extended residual nao referencia mais canal legado', () => {
    const residualModulePath = path.join(process.cwd(), 'api', 'modules', 'extended-residual');
    
    // extended-residual has been completely removed
    expect(fs.existsSync(residualModulePath)).toBe(false);
  });
});

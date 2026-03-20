'use strict';

const fs = require('fs');
const path = require('path');

describe('extended channel cutover wiring', () => {
  test('registerRoutes monta routers migrados de canais extendidos', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createPublicApiRoutes/);
    expect(source).toMatch(/createChannelWebhookRoutes/);
    expect(source).toMatch(/createWhatsAppConnectionRoutes/);
    expect(source).toMatch(/createWhatsAppIvrRoutes/);
    expect(source).toMatch(/createWhatsAppQrWebhookRoutes/);

    expect(source).toMatch(/app\.use\(publicApiRouter\)/);
    expect(source).toMatch(/app\.use\(channelWebhookRouter\)/);
    expect(source).toMatch(/app\.use\(whatsAppConnectionRouter\)/);
    expect(source).toMatch(/app\.use\(whatsAppIvrRouter\)/);
    expect(source).toMatch(/app\.use\(whatsAppQrWebhookRouter\)/);
  });

  test('extended residual nao referencia mais canal legado', () => {
    const residualModulePath = path.join(process.cwd(), 'api', 'modules', 'extended-residual');
    
    // extended-residual has been completely removed
    expect(fs.existsSync(residualModulePath)).toBe(false);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('platform residual elimination wiring', () => {
  test('registerRoutes monta routers de platform sem residual', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createPlatformAdminExpressRouter/);
    expect(source).toMatch(/createPlatformContentExpressRouter/);
    expect(source).toMatch(/createPlatformPublicExpressRouter/);
    expect(source).not.toMatch(/createPlatformResidualRoutes/);

    expect(source).toMatch(/app\.use\(platformAdminRouter\)/);
    expect(source).toMatch(/app\.use\(platformContentRouter\)/);
    expect(source).toMatch(/app\.use\(platformPublicRouter\)/);
  });

  test('platform admin router agrega handlers e modulos esperados', () => {
    const routesPath = path.join(process.cwd(), 'api', 'modules', 'platform-admin', 'routes.js');
    const source = fs.readFileSync(routesPath, 'utf8');

    expect(source).toMatch(/handleChannelAccountRoutes/);
    expect(source).toMatch(/handleDepartmentRoutes/);
    expect(source).toMatch(/handleExportRoutes/);
    expect(source).toMatch(/handleSegmentationRoutes/);
    expect(source).toMatch(/handleConfigAdminRoutes/);
    expect(source).toMatch(/createConfigRoutes/);
    expect(source).toMatch(/createQueueRoutes/);
  });

  test('platform content router agrega handlers esperados', () => {
    const routesPath = path.join(process.cwd(), 'api', 'modules', 'platform-content', 'routes.js');
    const source = fs.readFileSync(routesPath, 'utf8');

    expect(source).toMatch(/handleAiRoutes/);
    expect(source).toMatch(/handleTemplatesRoutes/);
    expect(source).toMatch(/handleAiSuggestionRoutes/);
    expect(source).toMatch(/handleAudioTranscriptionRoutes/);
    expect(source).toMatch(/handleWhatsappTemplateRoutes/);
    expect(source).toMatch(/handleRagRoutes/);
  });

  test('platform public router agrega handlers e modulo esperados', () => {
    const routesPath = path.join(process.cwd(), 'api', 'modules', 'platform-public', 'routes.js');
    const source = fs.readFileSync(routesPath, 'utf8');

    expect(source).toMatch(/handleStorefrontRoutes/);
    expect(source).toMatch(/handlePhysicalPublicRoutes/);
    expect(source).toMatch(/handlePhysicalStationRoutes/);
    expect(source).toMatch(/createPublicTokenRoutes/);
  });

  test('platform-residual directory foi removido', () => {
    const residualPath = path.join(process.cwd(), 'api', 'modules', 'platform-residual');
    expect(fs.existsSync(residualPath)).toBe(false);
  });
});

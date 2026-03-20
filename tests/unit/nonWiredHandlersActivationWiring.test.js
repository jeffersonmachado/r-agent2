'use strict';

const fs = require('fs');
const path = require('path');

describe('non-wired handlers activation wiring', () => {
  test('registerRoutes monta analytics, bulk-campaigns e quick-replies routers', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createAnalyticsRoutes/);
    expect(source).toMatch(/createBulkCampaignsRoutes/);
    expect(source).toMatch(/createQuickRepliesRoutes/);

    expect(source).toMatch(/app\.use\(analyticsRouter\)/);
    expect(source).toMatch(/app\.use\(bulkCampaignsRouter\)/);
    expect(source).toMatch(/app\.use\(quickRepliesRouter\)/);
  });

  test('routers novos delegam para handlers corretos', () => {
    const analyticsRouterPath = path.join(process.cwd(), 'api', 'modules', 'analytics', 'routes.js');
    const bulkRouterPath = path.join(process.cwd(), 'api', 'modules', 'bulk-campaigns', 'routes.js');
    const quickRouterPath = path.join(process.cwd(), 'api', 'modules', 'quick-replies', 'routes.js');

    const analyticsRouterSource = fs.readFileSync(analyticsRouterPath, 'utf8');
    const bulkRouterSource = fs.readFileSync(bulkRouterPath, 'utf8');
    const quickRouterSource = fs.readFileSync(quickRouterPath, 'utf8');

    expect(analyticsRouterSource).toMatch(/handleAnalyticsRoutes/);
    expect(analyticsRouterSource).toMatch(/serverHandlers\/analyticsRoutes/);

    expect(bulkRouterSource).toMatch(/handleBulkCampaignsRoutes/);
    expect(bulkRouterSource).toMatch(/serverHandlers\/bulkCampaignsRoutes/);

    expect(quickRouterSource).toMatch(/handleQuickRepliesRoutes/);
    expect(quickRouterSource).toMatch(/serverHandlers\/quickRepliesRoutes/);
  });
});

'use strict';

const fs = require('fs');
const path = require('path');

describe('non-wired handlers activation wiring', () => {
  test('registerRoutes monta analytics, bulk-campaigns e quick-replies routers', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createAnalyticsExpressRouter/);
    expect(source).toMatch(/createBulkCampaignsExpressRouter/);
    expect(source).toMatch(/createQuickRepliesExpressRouter/);

    expect(source).toMatch(/analyticsRouter,/);
    expect(source).toMatch(/bulkCampaignsRouter,/);
    expect(source).toMatch(/quickRepliesRouter,/);
  });

  test('routers novos mantêm bulk-campaigns, analytics e quick-replies nativos', () => {
    const analyticsRouterPath = path.join(process.cwd(), 'api', 'modules', 'analytics', 'routes.js');
    const bulkRouterPath = path.join(process.cwd(), 'api', 'modules', 'bulk-campaigns', 'routes.js');
    const quickRouterPath = path.join(process.cwd(), 'api', 'modules', 'quick-replies', 'routes.js');

    const analyticsRouterSource = fs.readFileSync(analyticsRouterPath, 'utf8');
    const bulkRouterSource = fs.readFileSync(bulkRouterPath, 'utf8');
    const quickRouterSource = fs.readFileSync(quickRouterPath, 'utf8');

    expect(analyticsRouterSource).not.toMatch(/serverHandlers\/analyticsRoutes/);
    expect(analyticsRouterSource).toMatch(/router\.get\('\/analytics\/metrics'/);

    expect(bulkRouterSource).toMatch(/handleBulkCampaignsRoutes/);
    expect(bulkRouterSource).toMatch(/\.\/handleBulkCampaignsRoutes/);

    expect(quickRouterSource).not.toMatch(/serverHandlers\/quickRepliesRoutes/);
    expect(quickRouterSource).toMatch(/router\.get\('\/quick-replies'/);
  });
});

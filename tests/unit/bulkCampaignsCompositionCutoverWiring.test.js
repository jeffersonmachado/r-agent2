'use strict';

const fs = require('fs');
const path = require('path');

describe('bulk-campaigns composition cutover wiring', () => {
  test('registerRoutes delega bulk-campaigns para composition root', () => {
    const registerRoutesPath = path.join(process.cwd(), 'api', 'app', 'registerRoutes.js');
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toMatch(/createBulkCampaignsExpressRouter/);
    expect(source).toMatch(/const bulkCampaignsRouter = createBulkCampaignsExpressRouter\(\)/);
    expect(source).not.toMatch(/buildBulkCampaignsRouteDeps/);
  });

  test('composition bulk-campaigns injeta deps do dominio', () => {
    const compositionPath = path.join(process.cwd(), 'api', 'composition', 'bulk-campaigns', 'index.js');
    const source = fs.readFileSync(compositionPath, 'utf8');

    expect(source).toMatch(/createBulkCampaignsRoutes/);
    expect(source).toMatch(/listCampaigns/);
    expect(source).toMatch(/startCampaign/);
    expect(source).toMatch(/resumeCampaign/);
  });
});

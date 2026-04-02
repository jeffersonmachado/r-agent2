'use strict';

const { createMarketingService } = require('../../api/modules/marketing/service');
const { createMarketingController } = require('../../api/modules/marketing/controller');
const { createMarketingRoutes } = require('../../api/modules/marketing/routes');

describe('marketing module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createMarketingRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/api/marketing/forms',
      '/api/marketing/forms',
      '/api/marketing/links',
      '/api/marketing/links',
      '/api/marketing/leads',
      '/api/marketing/leads',
      '/api/marketing/leads/:leadId',
      '/api/marketing/leads/stats',
      '/api/marketing/scoring-rules',
      '/api/marketing/scoring-rules',
      '/api/marketing/email-campaigns',
      '/api/marketing/email-campaigns',
      '/api/marketing/email-campaigns/:campaignId/send',
    ]);
  });

  test('controller listLinks preserva erro 503 quando service falha', async () => {
    const deps = makeDeps();
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {
        listLinks: jest.fn(async () => ({ ok: false, error: 'links_unavailable' })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/api/marketing/links?limit=20' };
    const res = {};

    await controller.listLinks(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 503, { error: 'links_unavailable' });
  });

  test('controller createEmailCampaign retorna 201 no contrato atual', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'Campanha', subject: 'Oi' })),
    });
    const service = createMarketingService({
      marketingService: {
        createEmailCampaign: jest.fn(async () => ({ ok: true, id: 'cmp-1' })),
      },
      marketingLinkService: {},
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1' };
    const res = {};

    await controller.createEmailCampaign(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, { ok: true, id: 'cmp-1' });
  });
});

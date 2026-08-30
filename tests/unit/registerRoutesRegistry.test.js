'use strict';

const { createRouteRegistry } = require('../../api/app/routeRegistry');

describe('route registry', () => {
  test('preserves tenant mount path and terminal fallback order', () => {
    const registry = createRouteRegistry({
      publicSystemRouter: 'public-system',
      authRouter: 'auth',
      tenantRouter: 'tenant',
      domainAdminRouter: 'domain-admin',
      domainIdentityRouter: 'domain-identity',
      domainFlowRouter: 'domain-flow',
      ticketRouter: 'ticket',
      verticalRouter: 'vertical',
      pbxRouter: 'pbx',
      webhooksRouter: 'webhooks',
      operationsDashboardRouter: 'operations-dashboard',
      webScrapingRouter: 'web-scraping',
      qaRouter: 'qa',
      rpaTestsRouter: 'rpa-tests',
      devManagementRouter: 'dev-management',
      intelligenceRouter: 'intelligence',
      marketIntelligenceRouter: 'market-intelligence',
      accessControlRouter: 'access-control',
      voiceRouter: 'voice',
      analyticsRouter: 'analytics',
      bulkCampaignsRouter: 'bulk-campaigns',
      quickRepliesRouter: 'quick-replies',
      platformAdminRouter: 'platform-admin',
      platformContentRouter: 'platform-content',
      platformPublicRouter: 'platform-public',
      queueTicketRouter: 'queue-ticket',
      orderRouter: 'order',
      opsRouter: 'ops',
      executionLedgerRouter: 'execution-ledger',
      evidenceRouter: 'evidence',
      supportDebugRouter: 'support-debug',
      publicApiRouter: 'public-api',
      channelWebhookRouter: 'channel-webhook',
      whatsAppConnectionRouter: 'whatsapp-connection',
      whatsAppIvrRouter: 'whatsapp-ivr',
      whatsAppQrWebhookRouter: 'whatsapp-qr-webhook',
      domainOperationsRouter: 'domain-operations',
      domainBusinessRouter: 'domain-business',
      crmRouter: 'crm',
      tenantCapabilitiesRouter: 'tenant-capabilities',
      casesRouter: 'cases',
      frontendFallbackRouter: 'frontend-fallback',
    });

    expect(registry[2]).toEqual({ path: '/tenants', router: 'tenant' });
    expect(registry.find((entry) => entry.router === 'evidence')).toEqual({ router: 'evidence' });
    // Orders: módulo api/modules/order montado (pedidos das verticais food/market);
    // sem a montagem as páginas /orders, /kitchen e /dispatch recebiam 404.
    expect(registry.find((entry) => entry.router === 'order')).toEqual({ router: 'order' });
    expect(registry.find((entry) => entry.router === 'domain-business')).toEqual({ router: 'domain-business' });
    expect(registry.find((entry) => entry.router === 'crm')).toEqual({ router: 'crm' });
    // Tenant capabilities (/api/tenant/capabilities) e Cases (/cases) montados
    // antes do fallback terminal.
    expect(registry.find((entry) => entry.router === 'tenant-capabilities')).toEqual({ router: 'tenant-capabilities' });
    expect(registry.find((entry) => entry.router === 'cases')).toEqual({ router: 'cases' });
    expect(registry[registry.length - 1]).toEqual({ router: 'frontend-fallback' });
  });
});

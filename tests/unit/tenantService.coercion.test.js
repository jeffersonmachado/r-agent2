'use strict';

describe('tenantService coercion hardening', () => {
  let tenantService;
  let mockTenantModel;
  let mockTenantContextModel;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockTenantModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (payload) => ({
        ...payload,
        toJSON: () => ({
          tenant_key: payload.tenant_key,
          name: payload.name,
          site: payload.site,
          ramo_atividade: payload.ramo_atividade,
          objetivo: payload.objetivo,
          status: payload.status,
          plan: payload.plan,
          limits: payload.limits,
          settings: payload.settings,
          branding: payload.branding,
          created_at: new Date(),
          updated_at: new Date(),
          suspended_at: null,
          trial_expires_at: payload.trialExpiresAt || null,
        }),
      })),
    };

    mockTenantContextModel = {
      findByPk: jest.fn().mockResolvedValue(null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      destroy: jest.fn(async () => 1),
      findAll: jest.fn().mockResolvedValue([]),
    };

    jest.doMock('../../api/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((_, fallback) => fallback),
    }));

    jest.doMock('../../api/services/webScrapingService', () => ({
      scrapeUrl: jest.fn(),
    }));

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ connectionManager: { pool: {} } })),
    }));

    jest.doMock('../../api/db/models', () => ({
      Tenant: jest.fn(() => mockTenantModel),
      TenantContext: jest.fn(() => mockTenantContextModel),
      Flow: jest.fn(() => ({})),
    }));

    tenantService = require('../../api/services/tenantService');
  });

  test('createTenant em _aiSafeMode tolera site ausente sem quebrar', async () => {
    const out = await tenantService.createTenant({
      tenant_key: 'tenant-safe-1',
      name: 'Tenant Seguro',
      site: undefined,
      ramo_atividade: 'Comercio',
      objetivo: 'Atendimento',
      plan: 'trial',
      _aiSafeMode: true,
    });

    expect(out.success).toBe(true);
    expect(out.tenant).toBeDefined();
    expect(out.tenant.tenant_key).toBe('tenant-safe-1');
    expect(out.tenant.site).toBe(null);
  });

  test('findTenantBySite usa site normalizado (trim seguro)', async () => {
    mockTenantModel.findOne.mockResolvedValueOnce({
      toJSON: () => ({
        tenant_key: 'tenant-site',
        name: 'Tenant Site',
        site: 'https://acme.example',
        ramo_atividade: 'Tecnologia',
        objetivo: 'Escalar',
        status: 'active',
        plan: 'pro',
        limits: {},
        settings: {},
        branding: {},
        created_at: new Date(),
        updated_at: new Date(),
      }),
    });

    const out = await tenantService.findTenantBySite('  https://acme.example  ');

    expect(mockTenantModel.findOne).toHaveBeenCalledWith({ where: { site: 'https://acme.example' } });
    expect(out).toBeDefined();
    expect(out.tenant_key).toBe('tenant-site');
  });
});

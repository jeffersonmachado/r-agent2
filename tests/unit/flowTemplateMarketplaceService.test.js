/**
 * Testes unitários: FlowTemplateMarketplaceService (cache + filtros + isolamento tenant).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('FlowTemplateMarketplaceService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createTemplate adiciona ao cache e listTemplates filtra por tenant + global (tenant_key=system)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const global = await svc.createTemplate({
      tenantId: 'system',
      name: 'Global',
      tags: ['lead'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });
    expect(global.success).toBe(true);

    const tenant = await svc.createTemplate({
      tenantId: 'tenant-1',
      name: 'Tenant',
      tags: ['agendamento'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });
    expect(tenant.success).toBe(true);

    const listAll = svc.listTemplates({ tenantId: 'tenant-1', scope: 'all' });
    expect(listAll.some(t => t.id === global.template.id)).toBe(true);
    expect(listAll.some(t => t.id === tenant.template.id)).toBe(true);

    const listTenantOnly = svc.listTemplates({ tenantId: 'tenant-1', scope: 'tenant' });
    expect(listTenantOnly.some(t => t.id === global.template.id)).toBe(false);
    expect(listTenantOnly.some(t => t.id === tenant.template.id)).toBe(true);
  });

  test('listTemplates filtra por tag e q (busca)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    await svc.createTemplate({
      tenantId: 'system',
      name: 'Pesquisa NPS',
      description: 'Pesquisa de satisfação',
      tags: ['pesquisa_satisfacao'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    await svc.createTemplate({
      tenantId: 'system',
      name: 'Cobrança',
      description: 'Cobrança de fatura',
      tags: ['cobranca'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    const byTag = svc.listTemplates({ scope: 'global', tag: 'cobranca' });
    expect(byTag.length).toBe(1);
    expect(byTag[0].name).toContain('Cobrança');

    const byQ = svc.listTemplates({ scope: 'global', q: 'satisf' });
    expect(byQ.length).toBe(1);
    expect(byQ[0].name).toContain('Pesquisa');
  });

  test('getTemplate respeita isolamento tenant para templates não-globais', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const tenant = await svc.createTemplate({
      tenantId: 'tenant-1',
      name: 'Interno',
      tags: [],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    const ok = svc.getTemplate({ tenantId: 'tenant-1', id: tenant.template.id });
    expect(ok).not.toBeNull();

    const no = svc.getTemplate({ tenantId: 'tenant-2', id: tenant.template.id });
    expect(no).toBeNull();
  });
});


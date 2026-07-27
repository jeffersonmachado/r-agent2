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

  test('createTemplate adiciona ao cache e listTemplates filtra por tenant + global (built-in mkt-*)', async () => {
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
      id: 'mkt-lead-captacao',
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
      id: 'mkt-pesquisa-nps',
      name: 'Pesquisa NPS',
      description: 'Pesquisa de satisfação',
      tags: ['pesquisa_satisfacao'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    await svc.createTemplate({
      tenantId: 'system',
      id: 'mkt-cobranca',
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

  test('deleteTemplate permite remover template criado pelo próprio tenant system', async () => {
    // Regressão: templates criados por usuários do tenant system recebiam tenantId='system',
    // eram confundidos com templates globais built-in e nunca podiam ser removidos (403).
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const created = await svc.createTemplate({
      tenantId: 'system',
      name: 'Template do tenant system',
      tags: [],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });
    expect(created.success).toBe(true);

    const removed = await svc.deleteTemplate({ tenantId: 'system', id: created.template.id });
    expect(removed.success).toBe(true);
    expect(svc.getTemplate({ tenantId: 'system', id: created.template.id })).toBeNull();
  });

  test('deleteTemplate continua bloqueando templates globais built-in do marketplace', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const created = await svc.createTemplate({
      tenantId: 'system',
      id: 'mkt-agendamento',
      name: 'Built-in simulado',
      tags: [],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });
    expect(created.success).toBe(true);

    const denied = await svc.deleteTemplate({ tenantId: 'system', id: 'mkt-agendamento' });
    expect(denied.success).toBe(false);
    expect(denied.error).toBe('forbidden');
  });

  test('template criado pelo tenant system não vaza como global para outros tenants', async () => {
    // Regressão de isolamento: listTemplates(scope=all) incluía qualquer template com
    // tenantId='system' para todos os tenants, expondo conteúdo criado pelo tenant system.
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const systemOwned = await svc.createTemplate({
      tenantId: 'system',
      name: 'Interno do tenant system',
      tags: [],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });
    expect(systemOwned.success).toBe(true);

    const listOther = svc.listTemplates({ tenantId: 'tenant-2', scope: 'all' });
    expect(listOther.some(t => t.id === systemOwned.template.id)).toBe(false);
    expect(svc.getTemplate({ tenantId: 'tenant-2', id: systemOwned.template.id })).toBeNull();

    const listOwn = svc.listTemplates({ tenantId: 'system', scope: 'all' });
    expect(listOwn.some(t => t.id === systemOwned.template.id)).toBe(true);
  });
});


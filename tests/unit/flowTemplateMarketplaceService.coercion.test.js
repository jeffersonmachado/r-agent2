'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('flowTemplateMarketplaceService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function mockNoDb() {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ FlowTemplate: jest.fn() }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));
  }

  test('createTemplate rejeita name hostil sem lançar exceção', async () => {
    mockNoDb();
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    const hostileName = { toString() { throw new Error('boom-name'); } };
    const result = await svc.createTemplate({
      tenantId: 'tenant-1',
      name: hostileName,
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    expect(result).toEqual({ success: false, error: 'name é obrigatório' });
  });

  test('listTemplates tolera filtros tag/q hostis sem quebrar', async () => {
    mockNoDb();
    const svc = require('../../api/services/flowTemplateMarketplaceService');

    await svc.createTemplate({
      tenantId: 'system',
      name: 'Template A',
      description: 'Texto base',
      tags: ['abc'],
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    const hostileTag = { toString() { throw new Error('boom-tag'); } };
    const hostileQ = { toString() { throw new Error('boom-q'); } };

    expect(() => svc.listTemplates({ scope: 'global', tag: hostileTag })).not.toThrow();
    expect(() => svc.listTemplates({ scope: 'global', q: hostileQ })).not.toThrow();
  });

  test('initialize não estoura com err.message hostil ao carregar DB', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-init-message'); },
      enumerable: true,
    });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      FlowTemplate: jest.fn(() => ({
        findAll: jest.fn(async () => { throw hostileErr; }),
      })),
    }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    const svc = require('../../api/services/flowTemplateMarketplaceService');
    await expect(svc.initialize()).resolves.not.toThrow();
  });

  test('deleteTemplate segue best-effort quando destroy falha com err.message hostil', async () => {
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', {
      get() { throw new Error('boom-delete-message'); },
      enumerable: true,
    });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    const destroy = jest.fn(async () => { throw hostileErr; });
    const findByPk = jest.fn(async () => null);
    const create = jest.fn(async () => ({}));
    jest.doMock('../../api/db/models', () => ({
      FlowTemplate: jest.fn(() => ({ destroy, findByPk, create })),
    }));
    jest.doMock('../../engine/validator', () => ({
      validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
      addUiMessage: jest.fn(),
    }));

    const svc = require('../../api/services/flowTemplateMarketplaceService');
    const created = await svc.createTemplate({
      tenantId: 'tenant-1',
      name: 'Template B',
      flow: { nodes: [{ id: 'n1' }], edges: [] },
    });

    const out = await svc.deleteTemplate({ tenantId: 'tenant-1', id: created.template.id });
    expect(out).toEqual({ success: true, deletedId: created.template.id });
  });
});

/**
 * Testes unitários: CloseReasonsService (cache + validação).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('CloseReasonsService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createCloseReason valida tenantId e name', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ CloseReason: jest.fn() }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/closeReasonsService');

    const noTenant = await svc.createCloseReason({ tenantId: '', name: 'X' });
    expect(noTenant.success).toBe(false);

    const noName = await svc.createCloseReason({ tenantId: 'tenant-1', name: '' });
    expect(noName.success).toBe(false);
  });

  test('createCloseReason adiciona e listCloseReasons filtra por tenant', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ CloseReason: jest.fn() }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/closeReasonsService');

    const created = await svc.createCloseReason({ tenantId: 'tenant-1', name: 'Resolvido', createdBy: 'agent-1' });
    expect(created.success).toBe(true);
    expect(created.reason.tenantId).toBe('tenant-1');

    const list1 = svc.listCloseReasons({ tenantId: 'tenant-1' });
    expect(list1.some((r) => r.id === created.reason.id)).toBe(true);

    const list2 = svc.listCloseReasons({ tenantId: 'tenant-2' });
    expect(list2.some((r) => r.id === created.reason.id)).toBe(false);
  });
});


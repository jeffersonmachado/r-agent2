/**
 * DepartmentsService - isolamento multi-tenant
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('departmentsService (tenant isolation)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getDepartment(id, tenantId) não vaza departamento entre tenants', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/departmentsService');

    const created = svc.createDepartment({ tenantId: 't1', name: 'Suporte', agentIds: [], queueNames: [] });
    expect(created.success).toBe(true);

    const dept = created.department;
    expect(svc.getDepartment(dept.id, 't1')).toBeTruthy();
    expect(svc.getDepartment(dept.id, 't2')).toBeNull();
  });
});


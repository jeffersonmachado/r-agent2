/**
 * Testes unitários: ExecutionQueueService (fila de execução).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../infra/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));

describe('ExecutionQueueService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('enqueueJob valida tenantId e kind', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ ExecutionJob: jest.fn(() => ({ create: jest.fn() })) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/executionQueueService');

    try {
      await svc.enqueueJob({ tenantId: 'tenant-1', kind: '' });
      expect(true).toBe(false); // should throw
    } catch (err) {
      expect(err.message).toBe('kind_required');
    }
  });

  test('enqueueJob retorna erro se kind nao eh string', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ ExecutionJob: jest.fn(() => ({ create: jest.fn() })) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/executionQueueService');

    try {
      await svc.enqueueJob({ tenantId: 'tenant-1', kind: null });
      expect(true).toBe(false); // should throw
    } catch (err) {
      expect(err.message).toBe('kind_required');
    }
  });

  test('listDeadJobs tolera tenantId invalido (coerced to string)', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    const mockFindAndCountAll = jest.fn(async () => ({ count: 0, rows: [] }));
    jest.doMock('../../api/db/models', () => ({
      ExecutionJob: jest.fn(() => ({ findAndCountAll: mockFindAndCountAll })),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/executionQueueService');

    // Pass null tenantId (should coerce to 'system')
    const result = await svc.listDeadJobs({ tenantId: null });
    expect(result.total).toBe(0);
    expect(mockFindAndCountAll).toHaveBeenCalled();
    const whereArg = mockFindAndCountAll.mock.calls[0][0].where;
    expect(whereArg.tenant_key).toBe('system');
  });

  test('finishJob with errorMessage coerced safely', async () => {
    const mockQuery = jest.fn(async () => [[]]);
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({ query: mockQuery })) }));
    jest.doMock('../../api/db/models', () => ({ ExecutionJob: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/executionQueueService');

    // Pass object as errorMessage (should coerce to string safely)
    const err = new Error('test_error');
    await svc.finishJob({ jobId: 'job-1', status: 'failed', errorMessage: err });
    
    // Verify query was called (finishJob calls it to check attempts)
    expect(mockQuery).toHaveBeenCalled();
  });
});

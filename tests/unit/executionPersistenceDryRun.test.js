jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('executionPersistence - dry-run não persiste', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('persistExecution deve ser no-op quando executionMode=dry-run mesmo com DB disponível', async () => {
    const create = jest.fn(async () => ({}));
    const findByPk = jest.fn(async () => null);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})), // “DB disponível”
    }));

    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({ create, findByPk }),
    }));

    // eslint-disable-next-line global-require
    const { persistExecution } = require('../../api/services/executionPersistence');

    await persistExecution({
      executionId: 'exec-1',
      status: 'approved',
      payload: { name: 'X', description: 'Y', useRag: true, executionMode: 'dry-run' },
      stages: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      decisionAuthority: { type: 'system', approvedBy: 'test' },
    });

    expect(findByPk).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});


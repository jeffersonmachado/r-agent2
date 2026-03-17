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

// ─── hardening edge cases ────────────────────────────────────────────────────

describe('executionPersistence - hardening inputs hostis', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setupMocks({ findByPkResult = null } = {}) {
    jest.doMock('../../api/utils/logger', () => ({
      debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    const update = jest.fn(async () => ({}));
    const create = jest.fn(async () => ({}));
    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({ findByPk: jest.fn(async () => findByPkResult ? { update } : null), create }),
    }));
    return { update, create };
  }

  test('persistExecution – ragContext.sources com items hostis nao lanca excecao', async () => {
    setupMocks();
    const { persistExecution } = require('../../api/services/executionPersistence');
    const { proxy: hostileSource, revoke } = Proxy.revocable({ documentId: 'doc-1', chunksCount: 3 }, {});
    revoke();

    await expect(persistExecution({
      executionId: 'exec-hostile-src',
      status: 'approved',
      payload: { name: 'Test' },
      stages: {},
      ragContext: {
        success: true,
        chunks: [],
        sources: [hostileSource, { documentId: 'safe-doc', chunksCount: 1 }],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })).resolves.not.toThrow();
  });

  test('reuseDecision – persisted.stages como proxy revogado nao lanca excecao', async () => {
    const { proxy: hostileStages, revoke } = Proxy.revocable({ rag: true, evidence: true }, {});
    revoke();

    setupMocks({ findByPkResult: false }); // findByPk retorna null (nova linha)
    // Override com dado persistido direto via reuseDecision
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({
        findByPk: jest.fn(async () => ({
          data: {
            status: 'abstained',
            stages: hostileStages,
            decisionAuthority: null,
            abstentionReason: null,
            evidenceContext: null,
          },
        })),
      }),
    }));

    const { reuseDecision } = require('../../api/services/executionPersistence');
    const current = { status: 'pending', stages: { rag: false, evidence: false } };

    // Não deve lançar; stages hostil → safeKeys retorna [] → nenhuma etapa marcada
    await expect(reuseDecision('exec-hostile-stages', current)).resolves.not.toThrow();
  });

  test('reuseDecision – currentExecution.stages null nao lanca em approved', async () => {
    setupMocks({ findByPkResult: false });
    jest.doMock('../../api/db/models', () => ({
      Execution: () => ({
        findByPk: jest.fn(async () => ({
          data: { status: 'approved', stages: {}, decisionAuthority: null, abstentionReason: null, evidenceContext: null },
        })),
      }),
    }));

    const { reuseDecision } = require('../../api/services/executionPersistence');
    const current = { status: 'pending', stages: null }; // stages null → safeKeys retorna []

    await expect(reuseDecision('exec-null-stages', current)).resolves.not.toThrow();
  });
});


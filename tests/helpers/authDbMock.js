/**
 * Mock em memória da camada PostgreSQL/Sequelize para o authService.
 *
 * Segue o mesmo padrão de `tests/helpers/dbMock.js`: ao ser carregado,
 * registra `jest.mock` de `api/db/sequelize` e `api/db/models` (efeito
 * colateral), então deve ser requerido ANTES dos módulos que dependem do banco:
 *
 *   require('../../../tests/helpers/authDbMock');
 *   const { createAgent } = require('../authService');
 *
 * Diferença em relação ao dbMock genérico: os models User/Session aqui têm
 * comportamento stateful (store em memória), o que permite exercitar fluxos
 * completos de autenticação (createAgent -> login -> validateToken -> logout)
 * exatamente como o código real faz contra o PostgreSQL, incluindo os helpers
 * `sequelize.where/fn/col` usados nas buscas case-insensitive.
 *
 * IMPORTANTE: jest.config.cjs usa `resetMocks: true`, que remove as
 * implementações de todos os `jest.fn()` antes de cada teste. Por isso os
 * métodos abaixo são funções comuns (não jest.fn), que sobrevivem ao reset.
 */

// Shim mínimo do Sequelize usado pelos models mockados
// (authService usa `UserModel.sequelize.where/fn/col` e `sequelize.constructor.Op`)
const mockOp = { or: Symbol.for('sequelize.or') };

const mockSequelizeShim = {
  where: (condition, value) => ({ __authMockWhere: true, condition, value }),
  fn: (name, col) => ({ __authMockFn: true, name: String(name).toLowerCase(), col }),
  col: (name) => ({ __authMockCol: true, name }),
  transaction: async (callback) => callback({}),
  authenticate: async () => true,
  close: async () => true,
  connectionManager: { pool: {} },
};
mockSequelizeShim.constructor = { Op: mockOp };

/**
 * Avalia uma cláusula `where` do Sequelize contra uma linha do store.
 * Suporta: objeto plano ({ campo: valor }), arrays ({ campo: [v1, v2] }),
 * [Op.or] e where(fn('lower', col('campo')), valor) usado pelo authService.
 */
function matchesWhere(row, where) {
  if (where == null) return true;

  if (where.__authMockWhere) {
    const { condition, value } = where;
    if (
      condition &&
      condition.__authMockFn &&
      condition.name === 'lower' &&
      condition.col &&
      condition.col.__authMockCol
    ) {
      const field = condition.col.name;
      return String(row[field] == null ? '' : row[field]).toLowerCase() === String(value).toLowerCase();
    }
    return false;
  }

  if (typeof where === 'object') {
    const orConditions = where[mockOp.or];
    if (Array.isArray(orConditions)) {
      return orConditions.some((condition) => matchesWhere(row, condition));
    }
    return Object.keys(where).every((key) => {
      const expected = where[key];
      if (Array.isArray(expected)) return expected.includes(row[key]);
      return row[key] === expected;
    });
  }

  return false;
}

let mockIdCounter = 0;

/**
 * Cria um model mockado com store em memória e a API mínima do Sequelize
 * usada pelo authService (count/findAll/findOne/findByPk/create/update/destroy).
 */
function createStatefulModel(name) {
  const rows = [];
  return {
    __rows: rows,
    sequelize: mockSequelizeShim,
    count: async () => rows.length,
    findAll: async (options = {}) =>
      rows.filter((row) => matchesWhere(row, options && options.where)),
    findOne: async (options = {}) =>
      rows.find((row) => matchesWhere(row, options && options.where)) || null,
    findByPk: async (id) => rows.find((row) => row.id === id) || null,
    create: async (data = {}) => {
      const now = new Date();
      const row = { id: `${name}-${++mockIdCounter}`, created_at: now, updated_at: now, ...data };
      rows.push(row);
      return row;
    },
    update: async (data = {}, options = {}) => {
      let affected = 0;
      for (const row of rows) {
        if (matchesWhere(row, options && options.where)) {
          Object.assign(row, data);
          affected++;
        }
      }
      return [affected];
    },
    destroy: async (options = {}) => {
      let affected = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchesWhere(rows[i], options && options.where)) {
          rows.splice(i, 1);
          affected++;
        }
      }
      return affected;
    },
  };
}

const mockModelsStore = {
  User: createStatefulModel('user'),
  Session: createStatefulModel('session'),
  Tenant: createStatefulModel('tenant'),
  TenantContext: createStatefulModel('tenant-context'),
  TenantSetting: createStatefulModel('tenant-setting'),
};

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockSequelizeShim,
  connect: async () => mockSequelizeShim,
  close: async () => true,
  Sequelize: function SequelizeMock() {},
}));

jest.mock('../../api/db/models', () => {
  const factory = { defineRelationships: () => {} };
  for (const [name, model] of Object.entries(mockModelsStore)) {
    // api/db/models exporta getters (ex.: User(sequelize)); o authService
    // aceita tanto função quanto model direto (`typeof User === 'function' ? User() : User`)
    factory[name] = () => model;
    factory[`get${name}`] = () => model;
  }
  return factory;
});

/**
 * Retorna os models mockados (com o store em memória) para uso nos testes.
 */
function mockAuthDatabase() {
  return {
    mockSequelize: mockSequelizeShim,
    mockModels: mockModelsStore,
    mockOp,
  };
}

module.exports = {
  mockAuthDatabase,
  mockModelsStore,
  mockSequelizeShim,
  mockOp,
};

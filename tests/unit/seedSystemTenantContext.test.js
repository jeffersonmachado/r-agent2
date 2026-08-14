'use strict';

jest.mock('../../api/db/sequelize', () => ({
  connect: jest.fn(),
  close: jest.fn(),
  getSequelize: jest.fn(() => ({
    query: jest.fn().mockResolvedValue(undefined),
    constructor: { QueryTypes: { INSERT: 'INSERT' } },
  })),
}));

const db = require('../../api/db/sequelize');
const { ensureSystemTenantContext } = require('../../api/db/seed');

describe('system tenant context seed', () => {
  let sequelize;

  beforeEach(() => {
    sequelize = {
      query: jest.fn().mockResolvedValue(undefined),
      constructor: { QueryTypes: { INSERT: 'INSERT' } },
    };
    db.getSequelize.mockReturnValue(sequelize);
  });

  test('inserts the minimal context idempotently without overwriting existing data', async () => {
    await ensureSystemTenantContext();

    expect(sequelize.query).toHaveBeenCalledTimes(1);
    const [sql, options] = sequelize.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO tenant_contexts');
    expect(sql).toContain('ON CONFLICT (tenant_key) DO NOTHING');
    expect(options.replacements).toEqual({
      tenantKey: 'system',
      prioridade: 'HIGH',
      escopo: JSON.stringify(['rag', 'chatbot', 'classificacao_intencao']),
    });
  });
});

'use strict';

jest.mock('../../api/db/migrations-helper', () => ({
  tableExists: jest.fn(),
}));

const { tableExists } = require('../../api/db/migrations-helper');
const migration = require('../../api/db/migrations/20260809000001-corporate-agent-lifecycle-tenant-slug');

describe('corporate agent lifecycle migration', () => {
  let queryInterface;

  beforeEach(() => {
    jest.clearAllMocks();
    queryInterface = {
      sequelize: {
        query: jest.fn().mockResolvedValue(undefined),
      },
    };
  });

  test.each(['up', 'down'])('%s is a no-op when the historical table is absent', async direction => {
    tableExists.mockResolvedValue(false);

    await migration[direction](queryInterface);

    expect(tableExists).toHaveBeenCalledWith(queryInterface, 'corporate_agents');
    expect(queryInterface.sequelize.query).not.toHaveBeenCalled();
  });

  test('up applies the incremental constraints when the table exists', async () => {
    tableExists.mockResolvedValue(true);

    await migration.up(queryInterface);

    const calls = queryInterface.sequelize.query.mock.calls.map(([sql]) => sql);
    expect(calls).toHaveLength(6);
    // A constraint homônima da DDL histórica deve ser removida ANTES do
    // DROP INDEX, senão o Postgres falha ("constraint requires it").
    const dropConstraintIdx = calls.findIndex((sql) => sql.includes('DROP CONSTRAINT IF EXISTS corporate_agents_tenant_slug_uidx'));
    const dropIndexIdx = calls.findIndex((sql) => sql.includes('DROP INDEX IF EXISTS corporate_agents_tenant_slug_uidx'));
    expect(dropConstraintIdx).toBeGreaterThanOrEqual(0);
    expect(dropIndexIdx).toBeGreaterThan(dropConstraintIdx);
  });

  test('down restores the global UNIQUE when there is no slug collision', async () => {
    tableExists.mockResolvedValue(true);
    queryInterface.sequelize.query.mockResolvedValue([[], 0]);

    await migration.down(queryInterface);

    const calls = queryInterface.sequelize.query.mock.calls.map(([sql]) => sql);
    expect(calls.some((sql) => sql.includes('ADD CONSTRAINT corporate_agents_slug_key UNIQUE (slug)'))).toBe(true);
  });

  test('down skips the global UNIQUE when slugs collide across tenants', async () => {
    tableExists.mockResolvedValue(true);
    queryInterface.sequelize.query.mockImplementation(async (sql) => (
      sql.includes('GROUP BY slug') ? [[{ slug: 'dup' }], 1] : [[], 0]
    ));

    await migration.down(queryInterface);

    const calls = queryInterface.sequelize.query.mock.calls.map(([sql]) => sql);
    expect(calls.some((sql) => sql.includes('ADD CONSTRAINT corporate_agents_slug_key'))).toBe(false);
  });
});

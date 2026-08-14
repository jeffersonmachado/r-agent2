'use strict';

const migration = require('../../api/db/migrations/20260814090000-create-agent-os-core-tables');

describe('Agent OS core tables migration', () => {
  test('adds every legacy Agent OS table to the canonical Umzug path', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryInterface = { sequelize: { query } };

    await migration.up(queryInterface);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0];
    for (const table of [
      'corporate_agents',
      'kg_nodes',
      'kg_edges',
      'journey_registry',
      'learning_records',
      'ai_governance_records',
      'vertical_templates',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("'validated'");
    expect(sql).toContain('REFERENCES kg_nodes(id) ON DELETE CASCADE');
  });

  test('down preserves tables that may predate Umzug tracking', async () => {
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

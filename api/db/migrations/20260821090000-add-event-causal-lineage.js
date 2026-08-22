'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

const COLUMNS = Object.freeze({
  parent_event_id: { type: 'STRING', length: 160 },
  causation_id: { type: 'STRING', length: 160 },
  run_id: { type: 'STRING', length: 160 },
  critical_journey_id: { type: 'STRING', length: 160 },
  execution_id: { type: 'STRING', length: 160 },
  principal_id: { type: 'STRING', length: 160 },
});

async function addColumnIfMissing(queryInterface, Sequelize, name, spec) {
  const description = await queryInterface.describeTable('event_ledger');
  if (description[name]) return;
  await queryInterface.addColumn('event_ledger', name, {
    type: Sequelize[spec.type](spec.length),
    allowNull: true,
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const [name, spec] of Object.entries(COLUMNS)) {
      await addColumnIfMissing(queryInterface, Sequelize, name, spec);
    }
    await addIndexIfNotExists(
      queryInterface,
      'event_ledger',
      ['tenant_key', 'run_id', 'critical_journey_id', 'occurred_at'],
      { name: 'event_ledger_tenant_run_journey_occurred_idx' },
    );
    await addIndexIfNotExists(
      queryInterface,
      'event_ledger',
      ['tenant_key', 'execution_id', 'occurred_at'],
      { name: 'event_ledger_tenant_execution_occurred_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('event_ledger', 'event_ledger_tenant_execution_occurred_idx').catch(() => {});
    await queryInterface.removeIndex('event_ledger', 'event_ledger_tenant_run_journey_occurred_idx').catch(() => {});
    for (const name of Object.keys(COLUMNS).reverse()) {
      await queryInterface.removeColumn('event_ledger', name).catch(() => {});
    }
  },
};

'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (desc && desc[columnName]) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureColumn(queryInterface, 'ura_decision_audits', 'queue_id', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await addIndexIfNotExists(queryInterface, 'ura_decision_audits', ['tenant_key', 'queue_id'], {
      name: 'ura_audit_tenant_queue_idx',
    });
  },

  async down(queryInterface) {
    const desc = await queryInterface.describeTable('ura_decision_audits').catch(() => ({}));
    if (desc && desc.queue_id) {
      await queryInterface.removeColumn('ura_decision_audits', 'queue_id').catch(() => {});
    }
  },
};

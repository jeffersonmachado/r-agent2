'use strict';

const { addIndexIfNotExists } = require('../migrations-helper');

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (desc && desc[columnName]) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (!desc || !desc[columnName]) return;
  await queryInterface.removeColumn(tableName, columnName).catch(() => {});
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureColumn(queryInterface, 'operational_outcomes', 'contact_id', {
      type: Sequelize.STRING(191),
      allowNull: true,
    });
    await ensureColumn(queryInterface, 'operational_outcomes', 'signal_id', {
      type: Sequelize.STRING(191),
      allowNull: true,
    });
    await ensureColumn(queryInterface, 'operational_outcomes', 'recommendation_id', {
      type: Sequelize.STRING(191),
      allowNull: true,
    });
    await ensureColumn(queryInterface, 'operational_outcomes', 'action_type', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
    await ensureColumn(queryInterface, 'operational_outcomes', 'outcome_score', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });
    await ensureColumn(queryInterface, 'operational_outcomes', 'result_context_json', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'contact_id', 'produced_at'], {
      name: 'oper_outcomes_tenant_contact_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'signal_id', 'produced_at'], {
      name: 'oper_outcomes_tenant_signal_idx',
    });
    await addIndexIfNotExists(queryInterface, 'operational_outcomes', ['tenant_key', 'recommendation_id', 'produced_at'], {
      name: 'oper_outcomes_tenant_recommendation_idx',
    });
  },

  async down(queryInterface) {
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'result_context_json');
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'outcome_score');
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'action_type');
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'recommendation_id');
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'signal_id');
    await removeColumnIfExists(queryInterface, 'operational_outcomes', 'contact_id');
  },
};

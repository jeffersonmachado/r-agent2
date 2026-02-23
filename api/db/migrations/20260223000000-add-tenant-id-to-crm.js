'use strict';

const { tableExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const columns = await queryInterface.describeTable(tableName);
    return Boolean(columns && columns[columnName]);
  } catch (error) {
    return false;
  }
}

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (exists) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (!exists) return;
  await queryInterface.removeColumn(tableName, columnName);
}

async function backfillTenantId(queryInterface, tableName) {
  await queryInterface.sequelize.query(
    `UPDATE ${tableName} SET tenant_id = tenant_key WHERE tenant_id IS NULL`
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = [
      'crm_accounts',
      'crm_contacts',
      'crm_leads',
      'crm_pipelines',
      'crm_opportunities',
      'crm_activities',
      'crm_events',
    ];

    for (const tableName of tables) {
      if (!(await tableExists(queryInterface, tableName))) continue;
      await addColumnIfNotExists(queryInterface, tableName, 'tenant_id', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    for (const tableName of tables) {
      if (!(await tableExists(queryInterface, tableName))) continue;
      await backfillTenantId(queryInterface, tableName);
    }
  },

  async down(queryInterface) {
    const tables = [
      'crm_accounts',
      'crm_contacts',
      'crm_leads',
      'crm_pipelines',
      'crm_opportunities',
      'crm_activities',
      'crm_events',
    ];

    for (const tableName of tables) {
      if (!(await tableExists(queryInterface, tableName))) continue;
      await removeColumnIfExists(queryInterface, tableName, 'tenant_id');
    }
  },
};

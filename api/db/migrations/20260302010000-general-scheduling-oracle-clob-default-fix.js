'use strict';

const { tableExists } = require('../migrations-helper');

async function hasColumn(queryInterface, tableName, columnName) {
  try {
    const desc = await queryInterface.describeTable(tableName);
    return !!desc?.[columnName];
  } catch (_) {
    return false;
  }
}

async function backfillJsonText(queryInterface, tableName, columnName) {
  await queryInterface.bulkUpdate(tableName, { [columnName]: '{}' }, { [columnName]: null });
  await queryInterface.bulkUpdate(tableName, { [columnName]: '{}' }, { [columnName]: '' });
}

async function removeTextDefault(queryInterface, Sequelize, tableName, columnName) {
  if (!(await tableExists(queryInterface, tableName))) return;
  if (!(await hasColumn(queryInterface, tableName, columnName))) return;

  await backfillJsonText(queryInterface, tableName, columnName);
  await queryInterface.changeColumn(tableName, columnName, {
    type: Sequelize.TEXT,
    allowNull: false,
  });
}

async function restoreTextDefault(queryInterface, Sequelize, tableName, columnName) {
  if (!(await tableExists(queryInterface, tableName))) return;
  if (!(await hasColumn(queryInterface, tableName, columnName))) return;

  await queryInterface.changeColumn(tableName, columnName, {
    type: Sequelize.TEXT,
    allowNull: false,
    defaultValue: '{}',
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await removeTextDefault(queryInterface, Sequelize, 'operational_schedules', 'metadata');
    await removeTextDefault(queryInterface, Sequelize, 'schedule_reminders', 'payload');
    await removeTextDefault(queryInterface, Sequelize, 'schedule_blocks', 'metadata');
    await removeTextDefault(queryInterface, Sequelize, 'schedule_working_hours', 'metadata');
  },

  async down(queryInterface, Sequelize) {
    await restoreTextDefault(queryInterface, Sequelize, 'operational_schedules', 'metadata');
    await restoreTextDefault(queryInterface, Sequelize, 'schedule_reminders', 'payload');
    await restoreTextDefault(queryInterface, Sequelize, 'schedule_blocks', 'metadata');
    await restoreTextDefault(queryInterface, Sequelize, 'schedule_working_hours', 'metadata');
  },
};

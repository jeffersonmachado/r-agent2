'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const table = await queryInterface.describeTable(tableName);
    return !!table?.[columnName];
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const exists = await columnExists(queryInterface, 'autonomous_schedule_policies', 'min_gap_duration_minutes');
    if (!exists) {
      await queryInterface.addColumn('autonomous_schedule_policies', 'min_gap_duration_minutes', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 30,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE autonomous_schedule_policies
      SET min_gap_duration_minutes = 30
      WHERE min_gap_duration_minutes IS NULL
    `).catch(() => {});
  },

  async down(queryInterface) {
    const exists = await columnExists(queryInterface, 'autonomous_schedule_policies', 'min_gap_duration_minutes');
    if (exists) {
      await queryInterface.removeColumn('autonomous_schedule_policies', 'min_gap_duration_minutes');
    }
  },
};

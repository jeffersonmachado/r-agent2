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
    const exists = await columnExists(queryInterface, 'revenue_opportunities', 'metadata');
    if (!exists) {
      await queryInterface.addColumn('revenue_opportunities', 'metadata', {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '{}',
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE revenue_opportunities
      SET metadata = '{}'
      WHERE metadata IS NULL
    `).catch(() => {});
  },

  async down(queryInterface) {
    const exists = await columnExists(queryInterface, 'revenue_opportunities', 'metadata');
    if (exists) {
      await queryInterface.removeColumn('revenue_opportunities', 'metadata');
    }
  },
};

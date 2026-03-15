'use strict';

async function describeTableSafe(queryInterface, tableName) {
  try {
    return await queryInterface.describeTable(tableName);
  } catch (_) {
    return null;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await describeTableSafe(queryInterface, 'kiosk_sessions');
    if (!columns) return;

    if (!columns.contact_id) {
      await queryInterface.addColumn('kiosk_sessions', 'contact_id', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }

    if (!columns.ticket_id) {
      await queryInterface.addColumn('kiosk_sessions', 'ticket_id', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const columns = await describeTableSafe(queryInterface, 'kiosk_sessions');
    if (!columns) return;

    if (columns.ticket_id) {
      await queryInterface.removeColumn('kiosk_sessions', 'ticket_id');
    }

    if (columns.contact_id) {
      await queryInterface.removeColumn('kiosk_sessions', 'contact_id');
    }
  },
};
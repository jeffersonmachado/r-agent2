'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = :table
           AND column_name = :col
       ) AS "exists"`,
      { replacements: { table: String(tableName), col: String(columnName) } },
    );
    const r = Array.isArray(rows) && rows[0] ? rows[0] : null;
    return r && (r.exists === true || r.exists === 't');
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const has = await columnExists(queryInterface, 'event_dispatch_state', 'last_event_id');
    if (!has) {
      await queryInterface.addColumn('event_dispatch_state', 'last_event_id', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeColumn('event_dispatch_state', 'last_event_id');
    } catch (_) {
      // best-effort
    }
  },
};


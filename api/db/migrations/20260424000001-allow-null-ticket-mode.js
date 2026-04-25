'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const results = await queryInterface.sequelize.query(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${tableName.replace(/'/g, "''")}'
          AND column_name = '${columnName.replace(/'/g, "''")}'
      ) AS "exists"`,
      { type: queryInterface.sequelize.constructor.QueryTypes.SELECT }
    );
    const row = Array.isArray(results) ? results[0] : results;
    const exists = row?.exists ?? row?.['exists'];
    return exists === true || exists === 't' || exists === 'true';
  } catch (_) {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'tickets', 'mode'))) return;
    await queryInterface.changeColumn('tickets', 'mode', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
      comment: 'bot | human | paused | null',
    });
  },

  async down(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'tickets', 'mode'))) return;
    await queryInterface.changeColumn('tickets', 'mode', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'human',
      comment: 'bot | human | paused',
    });
  },
};

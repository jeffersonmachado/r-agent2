'use strict';

/**
 * Migration: add reason_code to outbound_queue (operacional)
 */

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
  } catch (err) {
    return false;
  }
}

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  const exists = await columnExists(queryInterface, tableName, columnName);
  if (exists) {
    // eslint-disable-next-line no-console
    console.log(`[Migration] Coluna ${tableName}.${columnName} já existe, pulando`);
    return;
  }
  await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfNotExists(queryInterface, 'outbound_queue', 'reason_code', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    const exists = await columnExists(queryInterface, 'outbound_queue', 'reason_code');
    if (exists) {
      await queryInterface.removeColumn('outbound_queue', 'reason_code');
    }
  },
};


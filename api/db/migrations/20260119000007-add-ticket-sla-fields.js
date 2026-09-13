/**
 * Migration: Add SLA fields to tickets table
 *
 * Adds:
 * - first_response_at
 * - resolved_at
 * - waiting_time_seconds
 * - handling_time_seconds
 */

'use strict';

const logger = require('../../utils/logger');

const { addIndexIfNotExists } = require('../migrations-helper');

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
    logger.info(`[Migration] Coluna ${tableName}.${columnName} já existe, pulando`);
    return;
  }
  await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfNotExists(queryInterface, 'tickets', 'first_response_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'resolved_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'waiting_time_seconds', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'handling_time_seconds', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'first_response_at'], {
      name: 'tickets_tenant_key_first_response_at_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'resolved_at'], {
      name: 'tickets_tenant_key_resolved_at_idx',
    });
  },

  async down(queryInterface) {
    // Down best-effort
    for (const col of ['first_response_at', 'resolved_at', 'waiting_time_seconds', 'handling_time_seconds']) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await columnExists(queryInterface, 'tickets', col);
      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await queryInterface.removeColumn('tickets', col);
      }
    }
  },
};


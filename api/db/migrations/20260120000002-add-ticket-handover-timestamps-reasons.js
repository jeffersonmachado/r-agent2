'use strict';

const logger = require('../../utils/logger');

/**
 * Migration: Add detailed handover timestamps/reasons to tickets table (Blip-like).
 *
 * Adds:
 * - takeover_at
 * - return_to_bot_at
 * - takeover_reason
 * - return_reason
 *
 * Observação:
 * - Mantém compatibilidade: colunas são nullable e preenchidas best-effort pelo runtime.
 */

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
    await addColumnIfNotExists(queryInterface, 'tickets', 'takeover_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'return_to_bot_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'takeover_reason', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'return_reason', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'takeover_at'], {
      name: 'tickets_tenant_key_takeover_at_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'return_to_bot_at'], {
      name: 'tickets_tenant_key_return_to_bot_at_idx',
    });
  },

  async down(queryInterface) {
    const qi = queryInterface;
    // eslint-disable-next-line no-console
    logger.info('[Migration] down: removendo colunas de handover timestamps/reasons em tickets (best-effort)');
    for (const col of ['takeover_at', 'return_to_bot_at', 'takeover_reason', 'return_reason']) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await columnExists(qi, 'tickets', col);
      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await qi.removeColumn('tickets', col);
      }
    }
  },
};


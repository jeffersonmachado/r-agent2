/**
 * Migration: Add handover fields to tickets table
 *
 * Adds:
 * - conversation_id (links ticket to omnichannel conversation)
 * - channel_type (whatsapp|instagram|webchat)
 * - mode (bot|human|paused|null)
 * - pause_reason (user_request|agent_takeover|outside_window|failed_delivery|compliance|inactivity)
 *
 * Defaults:
 * - mode is nullable; absence of mode should not imply bot or human control.
 */

'use strict';

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
    console.log(`[Migration] Coluna ${tableName}.${columnName} já existe, pulando`);
    return;
  }
  await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfNotExists(queryInterface, 'tickets', 'conversation_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'channel_type', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'whatsapp | instagram | webchat',
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'mode', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
      comment: 'bot | human | paused | null',
    });

    await addColumnIfNotExists(queryInterface, 'tickets', 'pause_reason', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Motivo de pausa/controle (user_request, agent_takeover, outside_window, failed_delivery, compliance, inactivity)',
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'conversation_id'], {
      name: 'tickets_tenant_key_conversation_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tickets', ['tenant_key', 'mode'], {
      name: 'tickets_tenant_key_mode_idx',
    });
  },

  async down(queryInterface) {
    // Down best-effort: remove colunas se existirem
    const qi = queryInterface;
    // eslint-disable-next-line no-console
    console.log('[Migration] down: removendo colunas de handover em tickets (best-effort)');
    for (const col of ['conversation_id', 'channel_type', 'mode', 'pause_reason']) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await columnExists(qi, 'tickets', col);
      if (exists) {
        // eslint-disable-next-line no-await-in-loop
        await qi.removeColumn('tickets', col);
      }
    }
  },
};

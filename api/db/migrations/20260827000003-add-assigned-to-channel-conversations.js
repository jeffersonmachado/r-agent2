/**
 * Migration: Add assigned_to (+ metadata) to channel_conversations
 *
 * - assigned_to: atendente responsável pela conversa quando não há ticket atual
 *   (inbox desacoplado de tickets).
 * - metadata: JSONB para dados operacionais da conversa sem ticket
 *   (ex.: notas internas quando current_ticket_id é nulo).
 *
 * Aditiva e reversível (down remove as colunas adicionadas).
 */

'use strict';

async function columnExists(queryInterface, tableName, columnName) {
  const [results] = await queryInterface.sequelize.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${tableName}' AND column_name = '${columnName}'
     ) AS exists`,
  );
  return Array.isArray(results) && results.length > 0
    ? (results[0].exists === true || results[0].exists === 't')
    : false;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'channel_conversations', 'assigned_to'))) {
      await queryInterface.addColumn('channel_conversations', 'assigned_to', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    if (!(await columnExists(queryInterface, 'channel_conversations', 'metadata'))) {
      await queryInterface.addColumn('channel_conversations', 'metadata', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('channel_conversations', 'assigned_to').catch(() => {});
    await queryInterface.removeColumn('channel_conversations', 'metadata').catch(() => {});
  },
};

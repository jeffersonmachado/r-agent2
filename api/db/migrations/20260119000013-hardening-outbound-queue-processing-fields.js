'use strict';

/**
 * Hardening: outbound_queue cluster-safe.
 *
 * Adiciona campos para "claim" de processamento:
 * - processing_at: quando o item foi reservado por um worker
 * - processing_by: identificador (hostname:pid) do worker
 */

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const desc = await queryInterface.describeTable(tableName);
    return !!desc[columnName];
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await columnExists(queryInterface, 'outbound_queue', 'processing_at'))) {
      await queryInterface.addColumn('outbound_queue', 'processing_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!(await columnExists(queryInterface, 'outbound_queue', 'processing_by'))) {
      await queryInterface.addColumn('outbound_queue', 'processing_by', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeColumn('outbound_queue', 'processing_by'); } catch {}
    try { await queryInterface.removeColumn('outbound_queue', 'processing_at'); } catch {}
  },
};


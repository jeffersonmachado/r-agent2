'use strict';

/**
 * Migration: Create ticket_media_files table
 *
 * Contexto (Database Integrity Wave, 2026-07-25):
 * - A tabela era criada apenas via `TicketMedia.sync()` em runtime
 *   (api/services/ticketMediaService.js), sem migration versionada.
 * - Aditiva e idempotente: usa createTableIfNotExists, então bancos que já
 *   têm a tabela (criada pelo sync) não são afetados.
 * - Alinhada ao model api/db/models/TicketMedia.js.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'ticket_media_files', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      file_name: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mime_type: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      size_bytes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      sha256: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      data: {
        type: Sequelize.BLOB('long'),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await addIndexIfNotExists(queryInterface, 'ticket_media_files', ['tenant_key'], {
      name: 'ticket_media_files_tenant_key_idx',
    });

    await addIndexIfNotExists(queryInterface, 'ticket_media_files', ['sha256'], {
      name: 'ticket_media_files_sha256_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_media_files');
  },
};

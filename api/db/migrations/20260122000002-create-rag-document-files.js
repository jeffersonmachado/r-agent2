'use strict';

/**
 * Migration: Create rag_document_files table (tenant_key-based, 1:1 with rag_documents)
 *
 * Stores the original binary uploaded file (bytea) to allow authenticated download.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'rag_document_files', {
      document_id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'rag_documents',
          key: 'id',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      filename: {
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
      data: {
        // Postgres: BYTEA
        type: Sequelize.BLOB('long'),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'rag_document_files', ['tenant_key'], {
      name: 'rag_document_files_tenant_key_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('rag_document_files');
  },
};


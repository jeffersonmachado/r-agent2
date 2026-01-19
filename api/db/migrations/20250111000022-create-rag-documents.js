'use strict';

/**
 * Migration: Create rag_documents table (tenant_key-based)
 *
 * Replaces rag_documents.json with PostgreSQL persistence.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'rag_documents', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      title: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      permissions: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active',
      },
      indexed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      indexed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      chunks_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await addIndexIfNotExists(queryInterface, 'rag_documents', ['tenant_key', 'status'], {
      name: 'rag_documents_tenant_key_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'rag_documents', ['tenant_key', 'indexed'], {
      name: 'rag_documents_tenant_key_indexed_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('rag_documents');
  },
};


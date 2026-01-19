'use strict';

/**
 * Migration: Create tenant_contexts table (tenant_key-based)
 *
 * Stores tenant cognitive context previously kept in tenant_contexts.json.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_contexts', {
      tenant_key: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      ramo_atividade: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      objetivo: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      site_oficial: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      prioridade: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'HIGH',
      },
      escopo: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: ['rag', 'chatbot', 'classificacao_intencao'],
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

    await addIndexIfNotExists(queryInterface, 'tenant_contexts', ['tenant_key'], {
      name: 'tenant_contexts_tenant_key_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_contexts');
  },
};


/**
 * Migration: Create tenant_ai_credentials table
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_ai_credentials', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      provider: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      api_key_encrypted: {
        type: Sequelize.TEXT,
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

    await addIndexIfNotExists(queryInterface, 'tenant_ai_credentials', ['tenant_id', 'provider'], {
      unique: true,
      name: 'tenant_ai_credentials_unique',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_ai_credentials', ['tenant_id'], {
      name: 'tenant_ai_credentials_tenant_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_ai_credentials', ['provider'], {
      name: 'tenant_ai_credentials_provider_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tenant_ai_credentials');
  },
};

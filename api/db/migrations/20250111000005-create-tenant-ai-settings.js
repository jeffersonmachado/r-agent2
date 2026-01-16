/**
 * Migration: Create tenant_ai_settings table
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_ai_settings', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: false,
        // unique: true removido - o índice único será criado explicitamente abaixo
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      provider: {
        type: Sequelize.STRING,
        defaultValue: 'openai',
        allowNull: false,
      },
      model: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      temperature: {
        type: Sequelize.DECIMAL(3, 2),
        allowNull: true,
      },
      max_tokens: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      quota_monthly: {
        type: Sequelize.INTEGER,
        allowNull: true,
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

    await addIndexIfNotExists(queryInterface, 'tenant_ai_settings', ['tenant_id'], {
      unique: true,
      name: 'tenant_ai_settings_tenant_id_unique',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_ai_settings', ['enabled'], {
      name: 'tenant_ai_settings_enabled_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_ai_settings', ['provider'], {
      name: 'tenant_ai_settings_provider_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tenant_ai_settings');
  },
};

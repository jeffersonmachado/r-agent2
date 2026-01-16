/**
 * Migration: Create tenants table
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenants', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
        // unique: true removido - o índice único será criado explicitamente abaixo
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      site: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      ramo_atividade: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      objetivo: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('trial', 'active', 'suspended', 'terminated'),
        defaultValue: 'trial',
        allowNull: false,
      },
      plan: {
        type: Sequelize.ENUM('free', 'trial', 'pro', 'enterprise'),
        defaultValue: 'trial',
        allowNull: false,
      },
      limits: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      settings: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      branding: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      suspended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      trial_expires_at: {
        type: Sequelize.DATE,
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

    await addIndexIfNotExists(queryInterface, 'tenants', ['tenant_key'], {
      unique: true,
      name: 'tenants_tenant_key_unique',
    });

    await addIndexIfNotExists(queryInterface, 'tenants', ['status'], {
      name: 'tenants_status_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenants', ['created_at'], {
      name: 'tenants_created_at_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tenants');
  },
};

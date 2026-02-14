/**
 * Migration: Create public_access_tokens table (tenant_key-based)
 *
 * Public tokens for kiosk/panel/storefront (URL token).
 */
 
'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'public_access_tokens', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      kind: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      location_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      token: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      meta: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
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

    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['token'], {
      name: 'public_access_tokens_token_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['tenant_key', 'kind'], {
      name: 'public_access_tokens_tenant_key_kind_idx',
    });
    await addIndexIfNotExists(queryInterface, 'public_access_tokens', ['tenant_key', 'location_id'], {
      name: 'public_access_tokens_tenant_key_location_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('public_access_tokens');
  },
};


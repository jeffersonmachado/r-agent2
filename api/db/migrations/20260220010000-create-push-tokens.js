'use strict';

const { createTableIfNotExists, addIndexIfNotExists, indexExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'push_tokens', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      platform: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      token: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      device_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      device_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      app_version: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
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

    await addIndexIfNotExists(queryInterface, 'push_tokens', ['platform', 'token'], {
      name: 'push_tokens_platform_token_uq',
      unique: true,
    });

    await addIndexIfNotExists(queryInterface, 'push_tokens', ['tenant_id', 'user_id'], {
      name: 'push_tokens_tenant_user_idx',
    });
  },

  async down(queryInterface) {
    if (await indexExists(queryInterface, 'push_tokens', 'push_tokens_platform_token_uq')) {
      await queryInterface.removeIndex('push_tokens', 'push_tokens_platform_token_uq');
    }
    if (await indexExists(queryInterface, 'push_tokens', 'push_tokens_tenant_user_idx')) {
      await queryInterface.removeIndex('push_tokens', 'push_tokens_tenant_user_idx');
    }
    await queryInterface.dropTable('push_tokens');
  },
};

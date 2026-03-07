'use strict';

const { createTableIfNotExists, addIndexIfNotExists, indexExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'web_push_subscriptions', {
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
      endpoint: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      subscription_json: {
        type: Sequelize.TEXT('long'),
        allowNull: false,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      device_name: {
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

    await addIndexIfNotExists(queryInterface, 'web_push_subscriptions', ['endpoint'], {
      name: 'web_push_subscriptions_endpoint_uq',
      unique: true,
    });

    await addIndexIfNotExists(queryInterface, 'web_push_subscriptions', ['tenant_id', 'user_id'], {
      name: 'web_push_subscriptions_tenant_user_idx',
    });
  },

  async down(queryInterface) {
    if (await indexExists(queryInterface, 'web_push_subscriptions', 'web_push_subscriptions_endpoint_uq')) {
      await queryInterface.removeIndex('web_push_subscriptions', 'web_push_subscriptions_endpoint_uq');
    }
    if (await indexExists(queryInterface, 'web_push_subscriptions', 'web_push_subscriptions_tenant_user_idx')) {
      await queryInterface.removeIndex('web_push_subscriptions', 'web_push_subscriptions_tenant_user_idx');
    }
    await queryInterface.dropTable('web_push_subscriptions');
  },
};

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

/**
 * Migration: Push subscriptions (Web Push / PWA)
 *
 * Inscrições de Web Push por usuário/tenant para notificações de novas
 * mensagens do Inbox (P3.11). Endpoint é único por tenant; keys (p256dh/auth)
 * ficam em JSONB. Expiradas (404/410) são removidas pelo sender.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'push_subscriptions', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      user_id: { type: Sequelize.STRING, allowNull: false },
      endpoint: { type: Sequelize.TEXT, allowNull: false },
      keys: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      device_name: { type: Sequelize.STRING, allowNull: true },
      user_agent: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'push_subscriptions', ['tenant_key', 'user_id'], {
      name: 'psub_tenant_user_idx',
    });
    await addIndexIfNotExists(queryInterface, 'push_subscriptions', ['tenant_key', 'endpoint'], {
      name: 'psub_tenant_endpoint_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('push_subscriptions');
  },
};

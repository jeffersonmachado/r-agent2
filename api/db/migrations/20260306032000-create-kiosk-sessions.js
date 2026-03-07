'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'kiosk_sessions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      kiosk_code: { type: Sequelize.STRING(100), allowNull: false },
      session_token: { type: Sequelize.STRING(100), allowNull: false },
      contact_id: { type: Sequelize.STRING(128), allowNull: true },
      ticket_id: { type: Sequelize.STRING(128), allowNull: true },
      metadata_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'open' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'kiosk_sessions', ['tenant_key', 'kiosk_code'], {
      name: 'kiosk_sessions_tenant_kiosk_idx',
    });
    await addIndexIfNotExists(queryInterface, 'kiosk_sessions', ['session_token'], {
      unique: true,
      name: 'kiosk_sessions_token_uidx',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('kiosk_sessions');
  },
};

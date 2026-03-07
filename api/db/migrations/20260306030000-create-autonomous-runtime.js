'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'autonomous_runtime', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      auto_detect_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      auto_campaign_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      auto_expire_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      run_interval_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      max_campaigns_per_run: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
      max_invites_per_run: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
      quiet_hours_start: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '22:00' },
      quiet_hours_end: { type: Sequelize.STRING(5), allowNull: false, defaultValue: '07:00' },
      enabled_channels_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '["whatsapp"]' },
      safety_mode: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'manual' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'autonomous_runtime', ['tenant_key'], {
      unique: true,
      name: 'autonomous_runtime_tenant_uidx',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('autonomous_runtime');
  },
};

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'marketing_ad_conversions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      lead_id: { type: Sequelize.STRING, allowNull: true },
      platform: { type: Sequelize.STRING, allowNull: false, defaultValue: 'google_ads' },
      click_id_type: { type: Sequelize.STRING, allowNull: false },
      click_id: { type: Sequelize.STRING, allowNull: false },
      conversion_name: { type: Sequelize.STRING, allowNull: false },
      conversion_action_id: { type: Sequelize.STRING, allowNull: true },
      conversion_time: { type: Sequelize.DATE, allowNull: false },
      conversion_value: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      currency_code: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'BRL' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 5 },
      uploaded_at: { type: Sequelize.DATE, allowNull: true },
      external_upload_id: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'marketing_ad_conversions', ['tenant_key', 'status', 'created_at'], {
      name: 'marketing_ad_conversions_tenant_status_created_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ad_conversions', ['tenant_key', 'lead_id'], {
      name: 'marketing_ad_conversions_tenant_lead_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ad_conversions', ['tenant_key', 'platform', 'conversion_name'], {
      name: 'marketing_ad_conversions_tenant_platform_name_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ad_conversions', ['tenant_key', 'idempotency_key'], {
      name: 'marketing_ad_conversions_tenant_idempotency_uq',
      unique: true,
      where: {
        idempotency_key: {
          [Sequelize.Op.ne]: null,
        },
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('marketing_ad_conversions').catch(() => {});
  },
};
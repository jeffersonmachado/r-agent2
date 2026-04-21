/**
 * Model MarketingAdConversion - Conversoes offline para plataformas de ads
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingAdConversion = null;

function getMarketingAdConversionModel() {
  if (!MarketingAdConversion) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingAdConversion = sequelize.define('MarketingAdConversion', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      lead_id: { type: DataTypes.STRING, allowNull: true },
      platform: { type: DataTypes.STRING, allowNull: false, defaultValue: 'google_ads' },
      click_id_type: { type: DataTypes.STRING, allowNull: false },
      click_id: { type: DataTypes.STRING, allowNull: false },
      conversion_name: { type: DataTypes.STRING, allowNull: false },
      conversion_action_id: { type: DataTypes.STRING, allowNull: true },
      conversion_time: { type: DataTypes.DATE, allowNull: false },
      conversion_value: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      currency_code: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'BRL' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
      uploaded_at: { type: DataTypes.DATE, allowNull: true },
      external_upload_id: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'marketing_ad_conversions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'created_at'], name: 'marketing_ad_conversions_tenant_status_created_idx' },
        { fields: ['tenant_key', 'lead_id'], name: 'marketing_ad_conversions_tenant_lead_idx' },
        { fields: ['tenant_key', 'platform', 'conversion_name'], name: 'marketing_ad_conversions_tenant_platform_name_idx' },
      ],
    });
  }

  return MarketingAdConversion;
}

module.exports = getMarketingAdConversionModel;
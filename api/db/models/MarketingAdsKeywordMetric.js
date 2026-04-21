/**
 * Model MarketingAdsKeywordMetric - Desempenho diário por keyword no Google Ads
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingAdsKeywordMetric = null;

function getMarketingAdsKeywordMetricModel() {
  if (!MarketingAdsKeywordMetric) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingAdsKeywordMetric = sequelize.define('MarketingAdsKeywordMetric', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      platform: { type: DataTypes.STRING, allowNull: false, defaultValue: 'google_ads' },
      metric_date: { type: DataTypes.DATEONLY, allowNull: false },
      campaign_id: { type: DataTypes.STRING, allowNull: false },
      campaign_name: { type: DataTypes.STRING, allowNull: true },
      ad_group_id: { type: DataTypes.STRING, allowNull: true },
      ad_group_name: { type: DataTypes.STRING, allowNull: true },
      keyword_id: { type: DataTypes.STRING, allowNull: true },
      keyword_text: { type: DataTypes.STRING, allowNull: false },
      match_type: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: true },
      impressions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      clicks: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      cost: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversions: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversion_value: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      average_cpc: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
      ctr: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'marketing_ads_keyword_metrics',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'metric_date', 'campaign_id'], name: 'marketing_ads_keyword_metrics_tenant_date_campaign_idx' },
        { fields: ['tenant_key', 'keyword_text'], name: 'marketing_ads_keyword_metrics_tenant_keyword_idx' },
      ],
    });
  }

  return MarketingAdsKeywordMetric;
}

module.exports = getMarketingAdsKeywordMetricModel;
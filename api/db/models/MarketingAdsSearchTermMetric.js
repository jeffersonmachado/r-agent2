/**
 * Model MarketingAdsSearchTermMetric - Desempenho diário por search term no Google Ads
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingAdsSearchTermMetric = null;

function getMarketingAdsSearchTermMetricModel() {
  if (!MarketingAdsSearchTermMetric) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingAdsSearchTermMetric = sequelize.define('MarketingAdsSearchTermMetric', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      platform: { type: DataTypes.STRING, allowNull: false, defaultValue: 'google_ads' },
      metric_date: { type: DataTypes.DATEONLY, allowNull: false },
      campaign_id: { type: DataTypes.STRING, allowNull: false },
      campaign_name: { type: DataTypes.STRING, allowNull: true },
      ad_group_id: { type: DataTypes.STRING, allowNull: true },
      ad_group_name: { type: DataTypes.STRING, allowNull: true },
      search_term: { type: DataTypes.STRING, allowNull: false },
      match_type: { type: DataTypes.STRING, allowNull: true },
      matched_keyword_id: { type: DataTypes.STRING, allowNull: true },
      matched_keyword_text: { type: DataTypes.STRING, allowNull: true },
      matched_keyword_match_type: { type: DataTypes.STRING, allowNull: true },
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
      tableName: 'marketing_ads_search_term_metrics',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'metric_date', 'campaign_id'], name: 'marketing_ads_search_term_metrics_tenant_date_campaign_idx' },
        { fields: ['tenant_key', 'search_term'], name: 'marketing_ads_search_term_metrics_tenant_term_idx' },
      ],
    });
  }

  return MarketingAdsSearchTermMetric;
}

module.exports = getMarketingAdsSearchTermMetricModel;
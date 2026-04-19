'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'marketing_ads_keyword_metrics', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      platform: { type: Sequelize.STRING, allowNull: false, defaultValue: 'google_ads' },
      metric_date: { type: Sequelize.DATEONLY, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: false },
      campaign_name: { type: Sequelize.STRING, allowNull: true },
      ad_group_id: { type: Sequelize.STRING, allowNull: true },
      ad_group_name: { type: Sequelize.STRING, allowNull: true },
      keyword_id: { type: Sequelize.STRING, allowNull: true },
      keyword_text: { type: Sequelize.STRING, allowNull: false },
      match_type: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: true },
      impressions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      clicks: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      cost: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversions: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversion_value: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      average_cpc: { type: Sequelize.DECIMAL(14, 4), allowNull: true },
      ctr: { type: Sequelize.DECIMAL(10, 6), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'marketing_ads_search_term_metrics', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      platform: { type: Sequelize.STRING, allowNull: false, defaultValue: 'google_ads' },
      metric_date: { type: Sequelize.DATEONLY, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: false },
      campaign_name: { type: Sequelize.STRING, allowNull: true },
      ad_group_id: { type: Sequelize.STRING, allowNull: true },
      ad_group_name: { type: Sequelize.STRING, allowNull: true },
      search_term: { type: Sequelize.STRING, allowNull: false },
      match_type: { type: Sequelize.STRING, allowNull: true },
      matched_keyword_id: { type: Sequelize.STRING, allowNull: true },
      matched_keyword_text: { type: Sequelize.STRING, allowNull: true },
      matched_keyword_match_type: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: true },
      impressions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      clicks: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      cost: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversions: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      conversion_value: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      average_cpc: { type: Sequelize.DECIMAL(14, 4), allowNull: true },
      ctr: { type: Sequelize.DECIMAL(10, 6), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'marketing_ads_keyword_metrics', ['tenant_key', 'metric_date', 'campaign_id'], {
      name: 'marketing_ads_keyword_metrics_tenant_date_campaign_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ads_keyword_metrics', ['tenant_key', 'keyword_text'], {
      name: 'marketing_ads_keyword_metrics_tenant_keyword_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ads_keyword_metrics', ['tenant_key', 'campaign_id', 'ad_group_id', 'keyword_id', 'metric_date'], {
      name: 'marketing_ads_keyword_metrics_tenant_entity_date_idx',
      unique: true,
    });

    await addIndexIfNotExists(queryInterface, 'marketing_ads_search_term_metrics', ['tenant_key', 'metric_date', 'campaign_id'], {
      name: 'marketing_ads_search_term_metrics_tenant_date_campaign_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ads_search_term_metrics', ['tenant_key', 'search_term'], {
      name: 'marketing_ads_search_term_metrics_tenant_term_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_ads_search_term_metrics', ['tenant_key', 'campaign_id', 'ad_group_id', 'search_term', 'metric_date'], {
      name: 'marketing_ads_search_term_metrics_tenant_entity_date_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('marketing_ads_search_term_metrics').catch(() => {});
    await queryInterface.dropTable('marketing_ads_keyword_metrics').catch(() => {});
  },
};
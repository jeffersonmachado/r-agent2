'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'market_metric_aggregates', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      vertical: { type: Sequelize.STRING(120), allowNull: false },
      region: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'global' },
      metric_key: { type: Sequelize.STRING(120), allowNull: false },
      period_start: { type: Sequelize.DATE, allowNull: false },
      period_end: { type: Sequelize.DATE, allowNull: false },
      avg_value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      median_value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      p90_value: { type: Sequelize.DECIMAL(18, 6), allowNull: true },
      sample_size: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'market_metric_aggregates', ['vertical'], {
      name: 'market_metric_aggregates_vertical_idx',
    });
    await addIndexIfNotExists(queryInterface, 'market_metric_aggregates', ['region'], {
      name: 'market_metric_aggregates_region_idx',
    });
    await addIndexIfNotExists(queryInterface, 'market_metric_aggregates', ['vertical', 'region', 'metric_key', 'period_end'], {
      name: 'market_metric_aggregates_lookup_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('market_metric_aggregates').catch(() => {});
  },
};

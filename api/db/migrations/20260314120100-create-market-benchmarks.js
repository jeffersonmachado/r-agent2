'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'market_benchmarks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      metric_key: { type: Sequelize.STRING(120), allowNull: false },
      tenant_value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      market_avg: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      market_median: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      percentile: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 50 },
      evaluated_at: { type: Sequelize.DATE, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'market_benchmarks', ['tenant_key'], { name: 'market_benchmarks_tenant_key_idx' });
    await addIndexIfNotExists(queryInterface, 'market_benchmarks', ['tenant_key', 'metric_key'], { name: 'market_benchmarks_tenant_metric_idx' });
    await addIndexIfNotExists(queryInterface, 'market_benchmarks', ['evaluated_at'], { name: 'market_benchmarks_evaluated_at_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('market_benchmarks').catch(() => {});
  },
};

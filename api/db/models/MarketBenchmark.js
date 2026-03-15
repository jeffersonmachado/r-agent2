/**
 * Model MarketBenchmark - benchmark anonimo do tenant vs mercado
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketBenchmark = null;

function getMarketBenchmarkModel() {
  if (!MarketBenchmark) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketBenchmark = sequelize.define('MarketBenchmark', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      metric_key: { type: DataTypes.STRING(120), allowNull: false },
      tenant_value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      market_avg: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      market_median: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      percentile: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 },
      evaluated_at: { type: DataTypes.DATE, allowNull: false },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_benchmarks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'market_benchmarks_tenant_key_idx' },
        { fields: ['tenant_key', 'metric_key'], name: 'market_benchmarks_tenant_metric_idx' },
        { fields: ['evaluated_at'], name: 'market_benchmarks_evaluated_at_idx' },
      ],
    });
  }

  return MarketBenchmark;
}

module.exports = getMarketBenchmarkModel;

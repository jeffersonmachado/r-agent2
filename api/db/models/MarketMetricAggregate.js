/**
 * Model MarketMetricAggregate - metricas agregadas anonimizadas de mercado
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketMetricAggregate = null;

function getMarketMetricAggregateModel() {
  if (!MarketMetricAggregate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketMetricAggregate = sequelize.define('MarketMetricAggregate', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      vertical: { type: DataTypes.STRING(120), allowNull: false },
      region: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'global' },
      metric_key: { type: DataTypes.STRING(120), allowNull: false },
      period_start: { type: DataTypes.DATE, allowNull: false },
      period_end: { type: DataTypes.DATE, allowNull: false },
      avg_value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      median_value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      p90_value: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
      sample_size: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_metric_aggregates',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['vertical'], name: 'market_metric_aggregates_vertical_idx' },
        { fields: ['region'], name: 'market_metric_aggregates_region_idx' },
        {
          fields: ['vertical', 'region', 'metric_key', 'period_end'],
          name: 'market_metric_aggregates_lookup_idx',
        },
      ],
    });
  }

  return MarketMetricAggregate;
}

module.exports = getMarketMetricAggregateModel;

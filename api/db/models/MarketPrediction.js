/**
 * Model MarketPrediction - previsoes por tenant guiadas por mercado
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketPrediction = null;

function getMarketPredictionModel() {
  if (!MarketPrediction) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketPrediction = sequelize.define('MarketPrediction', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      prediction_type: { type: DataTypes.STRING(80), allowNull: false },
      target_metric: { type: DataTypes.STRING(120), allowNull: false },
      predicted_value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      confidence: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      prediction_window: { type: DataTypes.STRING(80), allowNull: false },
      evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      generated_at: { type: DataTypes.DATE, allowNull: false },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_predictions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'market_predictions_tenant_key_idx' },
        {
          fields: ['tenant_key', 'prediction_type', 'target_metric'],
          name: 'market_predictions_lookup_idx',
        },
        { fields: ['generated_at'], name: 'market_predictions_generated_at_idx' },
      ],
    });
  }

  return MarketPrediction;
}

module.exports = getMarketPredictionModel;

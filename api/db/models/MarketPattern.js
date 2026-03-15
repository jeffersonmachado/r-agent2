/**
 * Model MarketPattern - padroes anonimizados de mercado
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketPattern = null;

function getMarketPatternModel() {
  if (!MarketPattern) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketPattern = sequelize.define('MarketPattern', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      vertical: { type: DataTypes.STRING(120), allowNull: false },
      pattern_type: { type: DataTypes.STRING(80), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      confidence: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      detected_at: { type: DataTypes.DATE, allowNull: false },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_patterns',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['vertical'], name: 'market_patterns_vertical_idx' },
        { fields: ['vertical', 'pattern_type'], name: 'market_patterns_vertical_type_idx' },
        { fields: ['detected_at'], name: 'market_patterns_detected_at_idx' },
      ],
    });
  }

  return MarketPattern;
}

module.exports = getMarketPatternModel;

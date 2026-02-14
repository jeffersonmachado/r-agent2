/**
 * Model MarketingScoringRule - Regras de scoring (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingScoringRule = null;

function getMarketingScoringRuleModel() {
  if (!MarketingScoringRule) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingScoringRule = sequelize.define('MarketingScoringRule', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      delta: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      conditions: { type: DataTypes.JSONB, allowNull: true },
    }, {
      tableName: 'marketing_scoring_rules',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'event_type'], name: 'marketing_scoring_rules_tenant_event_idx' },
      ],
    });
  }

  return MarketingScoringRule;
}

module.exports = getMarketingScoringRuleModel;


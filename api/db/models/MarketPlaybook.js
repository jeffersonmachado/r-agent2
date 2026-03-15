/**
 * Model MarketPlaybook - playbooks anonimizados baseados em mercado
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketPlaybook = null;

function getMarketPlaybookModel() {
  if (!MarketPlaybook) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketPlaybook = sequelize.define('MarketPlaybook', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      vertical: { type: DataTypes.STRING(120), allowNull: false },
      problem_type: { type: DataTypes.STRING(80), allowNull: false },
      playbook_name: { type: DataTypes.STRING(180), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      success_rate: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0 },
      evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'market_playbooks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['vertical'], name: 'market_playbooks_vertical_idx' },
        { fields: ['vertical', 'problem_type'], name: 'market_playbooks_vertical_problem_idx' },
      ],
    });
  }

  return MarketPlaybook;
}

module.exports = getMarketPlaybookModel;

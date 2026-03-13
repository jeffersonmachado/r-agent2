/**
 * Model MarketingLinkClick - Cliques de links rastreáveis (UTM)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingLinkClick = null;

function getMarketingLinkClickModel() {
  if (!MarketingLinkClick) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingLinkClick = sequelize.define('MarketingLinkClick', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      link_id: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      target_url: { type: DataTypes.TEXT, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: true },
      campaign: { type: DataTypes.STRING, allowNull: true },
      medium: { type: DataTypes.STRING, allowNull: true },
      content: { type: DataTypes.STRING, allowNull: true },
      term: { type: DataTypes.STRING, allowNull: true },
      ip: { type: DataTypes.STRING, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      referrer: { type: DataTypes.TEXT, allowNull: true },
    }, {
      tableName: 'marketing_link_clicks',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'link_id'], name: 'marketing_link_clicks_tenant_link_idx' },
        { fields: ['tenant_key', 'code'], name: 'marketing_link_clicks_tenant_code_idx' },
      ],
    });
  }

  return MarketingLinkClick;
}

module.exports = getMarketingLinkClickModel;

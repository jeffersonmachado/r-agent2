/**
 * Model MarketingLink - Links rastreáveis (UTM)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingLink = null;

function getMarketingLinkModel() {
  if (!MarketingLink) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingLink = sequelize.define('MarketingLink', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      target_url: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      source: { type: DataTypes.STRING, allowNull: true },
      campaign: { type: DataTypes.STRING, allowNull: true },
      medium: { type: DataTypes.STRING, allowNull: true },
      content: { type: DataTypes.STRING, allowNull: true },
      term: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      click_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
      tableName: 'marketing_links',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'marketing_links_tenant_status_idx' },
        { fields: ['tenant_key', 'code'], name: 'marketing_links_tenant_code_idx' },
        { fields: ['code'], name: 'marketing_links_code_uq', unique: true },
      ],
    });
  }

  return MarketingLink;
}

module.exports = getMarketingLinkModel;

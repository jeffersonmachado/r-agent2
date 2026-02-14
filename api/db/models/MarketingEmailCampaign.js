/**
 * Model MarketingEmailCampaign - Campanhas de e-mail (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingEmailCampaign = null;

function getMarketingEmailCampaignModel() {
  if (!MarketingEmailCampaign) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingEmailCampaign = sequelize.define('MarketingEmailCampaign', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      subject: { type: DataTypes.STRING, allowNull: false },
      body_text: { type: DataTypes.TEXT, allowNull: false },
      body_html: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
      min_score: { type: DataTypes.INTEGER, allowNull: true },
      scheduled_at: { type: DataTypes.DATE, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'marketing_email_campaigns',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'marketing_email_campaigns_tenant_status_idx' },
      ],
    });
  }

  return MarketingEmailCampaign;
}

module.exports = getMarketingEmailCampaignModel;


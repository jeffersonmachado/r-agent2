/**
 * Model MarketingEmailSend - Entregas de e-mail por lead/campanha (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingEmailSend = null;

function getMarketingEmailSendModel() {
  if (!MarketingEmailSend) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingEmailSend = sequelize.define('MarketingEmailSend', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      campaign_id: { type: DataTypes.STRING, allowNull: false },
      lead_id: { type: DataTypes.STRING, allowNull: true },
      to_email: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      external_message_id: { type: DataTypes.STRING, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
    }, {
      tableName: 'marketing_email_sends',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'campaign_id'], name: 'marketing_email_sends_tenant_campaign_idx' },
        { fields: ['tenant_key', 'campaign_id', 'lead_id'], name: 'marketing_email_sends_campaign_lead_uq', unique: true },
      ],
    });
  }

  return MarketingEmailSend;
}

module.exports = getMarketingEmailSendModel;


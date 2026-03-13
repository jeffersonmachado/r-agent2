/**
 * Model MarketingLead - Leads (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingLead = null;

function getMarketingLeadModel() {
  if (!MarketingLead) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingLead = sequelize.define('MarketingLead', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: true },
      phone: { type: DataTypes.STRING, allowNull: true },
      external_id: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      stage: { type: DataTypes.STRING, allowNull: false, defaultValue: 'visitor' },
      score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      tableName: 'marketing_leads',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'email'], name: 'marketing_leads_tenant_email_idx' },
        { fields: ['tenant_key', 'phone'], name: 'marketing_leads_tenant_phone_idx' },
        { fields: ['tenant_key', 'external_id'], name: 'marketing_leads_tenant_external_id_idx' },
        { fields: ['tenant_key', 'stage'], name: 'marketing_leads_tenant_stage_idx' },
      ],
    });
  }

  return MarketingLead;
}

module.exports = getMarketingLeadModel;


/**
 * Model MarketingForm - Formulários + Landing Page simples (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingForm = null;

function getMarketingFormModel() {
  if (!MarketingForm) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingForm = sequelize.define('MarketingForm', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      landing_html: { type: DataTypes.TEXT, allowNull: true },
      settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'marketing_forms',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'slug'], name: 'marketing_forms_tenant_slug_uq', unique: true },
        { fields: ['tenant_key', 'status'], name: 'marketing_forms_tenant_status_idx' },
      ],
    });
  }

  return MarketingForm;
}

module.exports = getMarketingFormModel;


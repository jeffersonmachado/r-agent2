/**
 * Model MarketingFormSubmission - Submissões de formulário (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let MarketingFormSubmission = null;

function getMarketingFormSubmissionModel() {
  if (!MarketingFormSubmission) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    MarketingFormSubmission = sequelize.define('MarketingFormSubmission', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      location_id: { type: DataTypes.STRING, allowNull: true },
      form_id: { type: DataTypes.STRING, allowNull: false },
      lead_id: { type: DataTypes.STRING, allowNull: true },
      external_submission_id: { type: DataTypes.STRING, allowNull: true },
      data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ip_address: { type: DataTypes.STRING, allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
    }, {
      tableName: 'marketing_form_submissions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'form_id'], name: 'marketing_form_submissions_tenant_form_idx' },
        { fields: ['tenant_key', 'location_id'], name: 'marketing_form_submissions_tenant_location_id_idx' },
        { fields: ['tenant_key', 'external_submission_id'], name: 'marketing_form_submissions_tenant_external_submission_uq', unique: true },
      ],
    });
  }

  return MarketingFormSubmission;
}

module.exports = getMarketingFormSubmissionModel;


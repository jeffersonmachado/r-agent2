const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmOpportunity = null;

function getCrmOpportunityModel() {
  if (!CrmOpportunity) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmOpportunity = sequelize.define('CrmOpportunity', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      pipeline_id: { type: DataTypes.STRING, allowNull: false },
      stage_id: { type: DataTypes.STRING, allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      account_id: { type: DataTypes.STRING, allowNull: true },
      contact_id: { type: DataTypes.STRING, allowNull: true },
      lead_id: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      value_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'BRL' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      correlation_id: { type: DataTypes.STRING, allowNull: true },
      expected_close_at: { type: DataTypes.DATE, allowNull: true },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_opportunities',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'pipeline_id', 'stage_id'], name: 'crm_opps_tenant_pipeline_stage_idx' },
        { fields: ['tenant_key', 'owner_user_id'], name: 'crm_opps_tenant_owner_idx' },
        { fields: ['tenant_key', 'status'], name: 'crm_opps_tenant_status_idx' },
        { fields: ['tenant_key', 'correlation_id'], name: 'crm_opps_tenant_correlation_idx' },
      ],
    });
  }

  return CrmOpportunity;
}

module.exports = getCrmOpportunityModel;

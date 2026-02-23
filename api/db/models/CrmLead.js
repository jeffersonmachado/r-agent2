const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmLead = null;

function getCrmLeadModel() {
  if (!CrmLead) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmLead = sequelize.define('CrmLead', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      account_id: { type: DataTypes.STRING, allowNull: true },
      contact_id: { type: DataTypes.STRING, allowNull: true },
      external_id: { type: DataTypes.STRING, allowNull: true },
      source: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'new' },
      score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_leads',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status'], name: 'crm_leads_tenant_status_idx' },
        { fields: ['tenant_key', 'owner_user_id'], name: 'crm_leads_tenant_owner_idx' },
        { fields: ['tenant_key', 'external_id'], name: 'crm_leads_tenant_external_uq', unique: true },
      ],
    });
  }

  return CrmLead;
}

module.exports = getCrmLeadModel;

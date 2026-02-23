const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmActivity = null;

function getCrmActivityModel() {
  if (!CrmActivity) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmActivity = sequelize.define('CrmActivity', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      subject_type: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      account_id: { type: DataTypes.STRING, allowNull: true },
      contact_id: { type: DataTypes.STRING, allowNull: true },
      lead_id: { type: DataTypes.STRING, allowNull: true },
      opportunity_id: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      due_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      correlation_id: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_activities',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_type', 'subject_id'], name: 'crm_activities_tenant_subject_idx' },
        { fields: ['tenant_key', 'opportunity_id'], name: 'crm_activities_tenant_opp_idx' },
        { fields: ['tenant_key', 'owner_user_id', 'status'], name: 'crm_activities_tenant_owner_status_idx' },
        { fields: ['tenant_key', 'due_at'], name: 'crm_activities_tenant_due_idx' },
      ],
    });
  }

  return CrmActivity;
}

module.exports = getCrmActivityModel;

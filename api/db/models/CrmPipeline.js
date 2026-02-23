const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmPipeline = null;

function getCrmPipelineModel() {
  if (!CrmPipeline) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmPipeline = sequelize.define('CrmPipeline', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      name: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      stages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_pipelines',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'name'], name: 'crm_pipelines_tenant_name_uq', unique: true },
        { fields: ['tenant_key', 'status'], name: 'crm_pipelines_tenant_status_idx' },
      ],
    });
  }

  return CrmPipeline;
}

module.exports = getCrmPipelineModel;

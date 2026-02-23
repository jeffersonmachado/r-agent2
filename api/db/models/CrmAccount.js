const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmAccount = null;

function getCrmAccountModel() {
  if (!CrmAccount) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmAccount = sequelize.define('CrmAccount', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      external_id: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: false },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_accounts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'external_id'], name: 'crm_accounts_tenant_external_uq', unique: true },
        { fields: ['tenant_key', 'status'], name: 'crm_accounts_tenant_status_idx' },
      ],
    });
  }

  return CrmAccount;
}

module.exports = getCrmAccountModel;

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmContact = null;

function getCrmContactModel() {
  if (!CrmContact) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmContact = sequelize.define('CrmContact', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
      account_id: { type: DataTypes.STRING, allowNull: true },
      external_id: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: true },
      phone: { type: DataTypes.STRING, allowNull: true },
      role: { type: DataTypes.STRING, allowNull: true },
      owner_user_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      attributes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'crm_contacts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'account_id'], name: 'crm_contacts_tenant_account_idx' },
        { fields: ['tenant_key', 'email'], name: 'crm_contacts_tenant_email_idx' },
        { fields: ['tenant_key', 'phone'], name: 'crm_contacts_tenant_phone_idx' },
        { fields: ['tenant_key', 'external_id'], name: 'crm_contacts_tenant_external_uq', unique: true },
      ],
    });
  }

  return CrmContact;
}

module.exports = getCrmContactModel;

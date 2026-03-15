const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessMembership = null;

function getAccessMembershipModel() {
  if (!AccessMembership) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessMembership = sequelize.define('AccessMembership', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      vertical: { type: DataTypes.STRING, allowNull: false, defaultValue: 'fitness' },
      plan_name: { type: DataTypes.STRING, allowNull: true },
      billing_status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      unit_scope: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      start_at: { type: DataTypes.DATE, allowNull: true },
      end_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_memberships',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id'], name: 'access_memberships_tenant_subject_idx' },
        { fields: ['tenant_key', 'billing_status'], name: 'access_memberships_tenant_billing_idx' },
      ],
    });
  }

  return AccessMembership;
}

module.exports = getAccessMembershipModel;

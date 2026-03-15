const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessPolicy = null;

function getAccessPolicyModel() {
  if (!AccessPolicy) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessPolicy = sequelize.define('AccessPolicy', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false, defaultValue: 'fitness' },
      applies_to: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      days_allowed: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      time_start: { type: DataTypes.STRING, allowNull: true },
      time_end: { type: DataTypes.STRING, allowNull: true },
      unit_scope: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      max_entries_per_day: { type: DataTypes.INTEGER, allowNull: true },
      anti_passback_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'none' },
      grace_policy: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_policies',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical'], name: 'access_policies_tenant_vertical_idx' },
        { fields: ['tenant_key', 'name'], name: 'access_policies_tenant_name_idx' },
      ],
    });
  }

  return AccessPolicy;
}

module.exports = getAccessPolicyModel;

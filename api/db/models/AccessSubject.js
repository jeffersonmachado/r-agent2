const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessSubject = null;

function getAccessSubjectModel() {
  if (!AccessSubject) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessSubject = sequelize.define('AccessSubject', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      vertical_profile: { type: DataTypes.STRING, allowNull: false, defaultValue: 'fitness' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_subjects',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'customer_id'], name: 'access_subjects_tenant_customer_idx' },
        { fields: ['tenant_key', 'membership_id'], name: 'access_subjects_tenant_membership_idx' },
      ],
    });
  }

  return AccessSubject;
}

module.exports = getAccessSubjectModel;

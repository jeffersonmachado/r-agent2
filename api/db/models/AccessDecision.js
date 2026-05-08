const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessDecision = null;

function getAccessDecisionModel() {
  if (!AccessDecision) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessDecision = sequelize.define('AccessDecision', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      credential_id: { type: DataTypes.STRING, allowNull: true },
      action: { type: DataTypes.STRING, allowNull: false, defaultValue: 'enter' },
      decision: { type: DataTypes.STRING, allowNull: false },
      reason_code: { type: DataTypes.STRING, allowNull: false },
      reason_detail: { type: DataTypes.TEXT, allowNull: true },
      issued_at: { type: DataTypes.DATE, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      signature: { type: DataTypes.TEXT, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_decisions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'issued_at'], name: 'access_decisions_tenant_issued_idx' },
        { fields: ['tenant_key', 'subject_id', 'issued_at'], name: 'access_decisions_tenant_subject_issued_idx' },
      ],
    });
  }

  return AccessDecision;
}

module.exports = getAccessDecisionModel;

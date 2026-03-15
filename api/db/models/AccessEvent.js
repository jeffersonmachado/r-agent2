const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessEvent = null;

function getAccessEventModel() {
  if (!AccessEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessEvent = sequelize.define('AccessEvent', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      device_id: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      credential_id: { type: DataTypes.STRING, allowNull: true },
      decision_id: { type: DataTypes.STRING, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      direction: { type: DataTypes.STRING, allowNull: true },
      reason_code: { type: DataTypes.STRING, allowNull: true },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      raw_payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'occurred_at'], name: 'access_events_tenant_occurred_idx' },
        { fields: ['tenant_key', 'subject_id', 'occurred_at'], name: 'access_events_tenant_subject_occurred_idx' },
      ],
    });
  }

  return AccessEvent;
}

module.exports = getAccessEventModel;

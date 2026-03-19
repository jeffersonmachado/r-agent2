const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalJourneyEvent = null;

function getVerticalJourneyEventModel() {
  if (!VerticalJourneyEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalJourneyEvent = sequelize.define('VerticalJourneyEvent', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      schedule_id: { type: DataTypes.STRING, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      channel: { type: DataTypes.STRING, allowNull: true },
      triggered_by: { type: DataTypes.STRING, allowNull: true },
      correlation_id: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'vertical_journey_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'vertical', 'event_type'], name: 'vje_tenant_vertical_type_idx' },
        { fields: ['tenant_key', 'subject_id', 'occurred_at'], name: 'vje_tenant_subject_date_idx' },
        { fields: ['tenant_key', 'customer_id', 'occurred_at'], name: 'vje_tenant_customer_date_idx' },
      ],
    });
  }
  return VerticalJourneyEvent;
}

module.exports = getVerticalJourneyEventModel;

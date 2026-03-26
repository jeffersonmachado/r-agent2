const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let NotificationDelivery = null;

function getNotificationDeliveryModel() {
  if (!NotificationDelivery) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    NotificationDelivery = sequelize.define('NotificationDelivery', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      bundle_id: { type: DataTypes.STRING, allowNull: true },
      transaction_id: { type: DataTypes.STRING, allowNull: true },
      appointment_id: { type: DataTypes.STRING, allowNull: true },
      schedule_id: { type: DataTypes.STRING, allowNull: true },
      execution_job_id: { type: DataTypes.STRING, allowNull: true },
      event_type: { type: DataTypes.STRING, allowNull: false },
      template_key: { type: DataTypes.STRING, allowNull: true },
      channel: { type: DataTypes.STRING, allowNull: false, defaultValue: 'whatsapp' },
      recipient: { type: DataTypes.STRING, allowNull: true },
      recipient_resolved: { type: DataTypes.STRING, allowNull: true },
      recipient_masked: { type: DataTypes.STRING, allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      provider: { type: DataTypes.STRING, allowNull: true },
      provider_message_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
      last_attempt_at: { type: DataTypes.DATE, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'notification_deliveries',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'created_at'], name: 'nd_tenant_status_created_idx' },
        { fields: ['tenant_key', 'vertical', 'event_type'], name: 'nd_tenant_vertical_event_idx' },
        { fields: ['tenant_key', 'subject_id'], name: 'nd_tenant_subject_idx' },
        { fields: ['tenant_key', 'customer_id'], name: 'nd_tenant_customer_idx' },
        { fields: ['tenant_key', 'membership_id'], name: 'nd_tenant_membership_idx' },
        { fields: ['tenant_key', 'transaction_id'], name: 'nd_tenant_transaction_idx' },
        { fields: ['tenant_key', 'idempotency_key'], name: 'nd_tenant_idempotency_uq', unique: true },
      ],
    });
  }

  return NotificationDelivery;
}

module.exports = getNotificationDeliveryModel;

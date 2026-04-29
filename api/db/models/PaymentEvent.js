'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');
let PaymentEvent = null;
function getPaymentEventModel() {
  if (!PaymentEvent) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    PaymentEvent = sequelize.define('PaymentEvent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: true },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'payment' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, { tableName: 'payment_events', timestamps: true, updatedAt: false, underscored: true, indexes: [{ fields: ['tenant_id', 'entity_id', 'created_at'], name: 'payment_events_tenant_entity_created_idx' }, { fields: ['tenant_id', 'status'], name: 'payment_events_tenant_status_idx' }] });
  }
  return PaymentEvent;
}
module.exports = getPaymentEventModel;

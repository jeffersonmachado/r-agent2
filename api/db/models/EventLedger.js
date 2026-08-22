/**
 * Model EventLedger - event_ledger (tenant_key-based)
 *
 * Append-only canonical events for correlation across modules.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EventLedger = null;

function getEventLedgerModel() {
  if (!EventLedger) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EventLedger = sequelize.define('EventLedger', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'api' },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      received_at: { type: DataTypes.DATE, allowNull: false },
      correlation_id: { type: DataTypes.STRING, allowNull: true },
      parent_event_id: { type: DataTypes.STRING(160), allowNull: true },
      causation_id: { type: DataTypes.STRING(160), allowNull: true },
      run_id: { type: DataTypes.STRING(160), allowNull: true },
      critical_journey_id: { type: DataTypes.STRING(160), allowNull: true },
      execution_id: { type: DataTypes.STRING(160), allowNull: true },
      principal_id: { type: DataTypes.STRING(160), allowNull: true },
      subject_type: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      actor_type: { type: DataTypes.STRING, allowNull: true },
      actor_id: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'event_ledger',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'occurred_at'], name: 'event_ledger_tenant_occurred_at_idx' },
        { fields: ['tenant_key', 'type', 'occurred_at'], name: 'event_ledger_tenant_type_occurred_at_idx' },
        { fields: ['tenant_key', 'correlation_id', 'occurred_at'], name: 'event_ledger_tenant_correlation_occurred_at_idx' },
        { fields: ['tenant_key', 'run_id', 'critical_journey_id', 'occurred_at'], name: 'event_ledger_tenant_run_journey_occurred_idx' },
        { fields: ['tenant_key', 'execution_id', 'occurred_at'], name: 'event_ledger_tenant_execution_occurred_idx' },
        { fields: ['tenant_key', 'subject_type', 'subject_id', 'occurred_at'], name: 'event_ledger_tenant_subject_occurred_at_idx' },
        { fields: ['tenant_key', 'type', 'idempotency_key'], name: 'event_ledger_tenant_type_idempotency_uq', unique: true },
      ],
    });
  }

  return EventLedger;
}

module.exports = getEventLedgerModel;

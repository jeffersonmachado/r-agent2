const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BillingTransaction = null;

function getBillingTransactionModel() {
  if (!BillingTransaction) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BillingTransaction = sequelize.define('BillingTransaction', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      bundle_id: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      provider: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'BRL' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      due_at: { type: DataTypes.DATE, allowNull: true },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      external_customer_id: { type: DataTypes.STRING, allowNull: true },
      external_transaction_id: { type: DataTypes.STRING, allowNull: true },
      external_subscription_id: { type: DataTypes.STRING, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'billing_transactions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'due_at'], name: 'bt_tenant_status_due_idx' },
        { fields: ['tenant_key', 'membership_id'], name: 'bt_tenant_membership_idx' },
        { fields: ['tenant_key', 'bundle_id'], name: 'bt_tenant_bundle_idx' },
        // A unicidade da referência externa é escopada por TENANT + provider:
        // o mesmo `external_transaction_id` de provedores/academias diferentes
        // é legítimo e não pode colidir (ver migration
        // 20260910000002-scope-billing-external-txn-unique-by-tenant.js).
        { fields: ['tenant_key', 'provider', 'external_transaction_id'], name: 'bt_tenant_provider_external_txn_uq', unique: true },
        { fields: ['tenant_key', 'idempotency_key'], name: 'bt_tenant_idempotency_uq', unique: true },
      ],
    });
  }

  return BillingTransaction;
}

module.exports = getBillingTransactionModel;

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let BillingSubscription = null;

function getBillingSubscriptionModel() {
  if (!BillingSubscription) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    BillingSubscription = sequelize.define('BillingSubscription', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      bundle_id: { type: DataTypes.STRING, allowNull: true },
      subject_id: { type: DataTypes.STRING, allowNull: true },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      provider: { type: DataTypes.STRING, allowNull: false },
      external_customer_id: { type: DataTypes.STRING, allowNull: true },
      external_subscription_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'BRL' },
      cycle: { type: DataTypes.STRING, allowNull: false, defaultValue: 'MONTHLY' },
      next_charge_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'billing_subscriptions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'next_charge_at'], name: 'bs_tenant_status_next_idx' },
        { fields: ['tenant_key', 'membership_id'], name: 'bs_tenant_membership_idx' },
        { fields: ['provider', 'external_subscription_id'], name: 'bs_provider_external_sub_uq', unique: true },
      ],
    });
  }

  return BillingSubscription;
}

module.exports = getBillingSubscriptionModel;

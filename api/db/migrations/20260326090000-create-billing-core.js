'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'billing_transactions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      bundle_id: { type: Sequelize.STRING, allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'BRL' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      due_at: { type: Sequelize.DATE, allowNull: true },
      paid_at: { type: Sequelize.DATE, allowNull: true },
      external_customer_id: { type: Sequelize.STRING, allowNull: true },
      external_transaction_id: { type: Sequelize.STRING, allowNull: true },
      external_subscription_id: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['tenant_key', 'status', 'due_at'], {
      name: 'bt_tenant_status_due_idx',
    });
    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['tenant_key', 'membership_id'], {
      name: 'bt_tenant_membership_idx',
    });
    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['tenant_key', 'bundle_id'], {
      name: 'bt_tenant_bundle_idx',
    });
    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['provider', 'external_transaction_id'], {
      name: 'bt_provider_external_txn_uq',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'billing_transactions', ['tenant_key', 'idempotency_key'], {
      name: 'bt_tenant_idempotency_uq',
      unique: true,
      where: {
        idempotency_key: {
          [Sequelize.Op.ne]: null,
        },
      },
    });

    await createTableIfNotExists(queryInterface, 'billing_subscriptions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: false },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      bundle_id: { type: Sequelize.STRING, allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      external_customer_id: { type: Sequelize.STRING, allowNull: true },
      external_subscription_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false, defaultValue: 'BRL' },
      cycle: { type: Sequelize.STRING, allowNull: false, defaultValue: 'MONTHLY' },
      next_charge_at: { type: Sequelize.DATE, allowNull: true },
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'billing_subscriptions', ['tenant_key', 'status', 'next_charge_at'], {
      name: 'bs_tenant_status_next_idx',
    });
    await addIndexIfNotExists(queryInterface, 'billing_subscriptions', ['tenant_key', 'membership_id'], {
      name: 'bs_tenant_membership_idx',
    });
    await addIndexIfNotExists(queryInterface, 'billing_subscriptions', ['provider', 'external_subscription_id'], {
      name: 'bs_provider_external_sub_uq',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('billing_transactions').catch(() => {});
    await queryInterface.dropTable('billing_subscriptions').catch(() => {});
  },
};

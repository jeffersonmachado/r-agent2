'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'notification_deliveries', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      vertical: { type: Sequelize.STRING, allowNull: true },
      subject_id: { type: Sequelize.STRING, allowNull: true },
      customer_id: { type: Sequelize.STRING, allowNull: true },
      membership_id: { type: Sequelize.STRING, allowNull: true },
      bundle_id: { type: Sequelize.STRING, allowNull: true },
      transaction_id: { type: Sequelize.STRING, allowNull: true },
      appointment_id: { type: Sequelize.STRING, allowNull: true },
      schedule_id: { type: Sequelize.STRING, allowNull: true },
      execution_job_id: { type: Sequelize.STRING, allowNull: true },
      event_type: { type: Sequelize.STRING, allowNull: false },
      template_key: { type: Sequelize.STRING, allowNull: true },
      channel: { type: Sequelize.STRING, allowNull: false, defaultValue: 'whatsapp' },
      recipient: { type: Sequelize.STRING, allowNull: true },
      recipient_resolved: { type: Sequelize.STRING, allowNull: true },
      recipient_masked: { type: Sequelize.STRING, allowNull: true },
      message: { type: Sequelize.TEXT, allowNull: true },
      provider: { type: Sequelize.STRING, allowNull: true },
      provider_message_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      last_attempt_at: { type: Sequelize.DATE, allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'status', 'created_at'], {
      name: 'nd_tenant_status_created_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'vertical', 'event_type'], {
      name: 'nd_tenant_vertical_event_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'subject_id'], {
      name: 'nd_tenant_subject_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'customer_id'], {
      name: 'nd_tenant_customer_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'membership_id'], {
      name: 'nd_tenant_membership_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'transaction_id'], {
      name: 'nd_tenant_transaction_idx',
    });
    await addIndexIfNotExists(queryInterface, 'notification_deliveries', ['tenant_key', 'idempotency_key'], {
      name: 'nd_tenant_idempotency_uq',
      unique: true,
      where: {
        idempotency_key: {
          [Sequelize.Op.ne]: null,
        },
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_deliveries').catch(() => {});
  },
};

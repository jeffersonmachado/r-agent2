'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create CRM Webhooks table
    await queryInterface.createTable('crm_webhooks', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      events: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
        comment: 'Events that trigger this webhook: ["account.created", "opportunity.updated", ...]',
      },
      headers: {
        type: Sequelize.JSONB,
        defaultValue: {},
        comment: 'Custom headers to include in webhook requests',
      },
      retry_attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
      },
      retry_interval_seconds: {
        type: Sequelize.INTEGER,
        defaultValue: 60,
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      secret: {
        type: Sequelize.STRING(255),
        comment: 'Secret for HMAC signature verification',
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
        onUpdate: Sequelize.CURRENT_TIMESTAMP,
      },
    });

    // Create Webhook Events Queue table
    await queryInterface.createTable('crm_webhook_queue', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      webhook_id: {
        type: Sequelize.UUID,
        references: { model: 'crm_webhooks', key: 'id' },
        onDelete: 'CASCADE',
      },
      event: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'success', 'failed', 'retry'),
        defaultValue: 'pending',
      },
      attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      error_message: {
        type: Sequelize.TEXT,
      },
      last_attempted_at: {
        type: Sequelize.DATE,
      },
      next_retry_at: {
        type: Sequelize.DATE,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
        index: true,
      },
    });

    // Create API Integrations table
    await queryInterface.createTable('crm_api_integrations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      provider: {
        type: Sequelize.ENUM('salesforce', 'hubspot', 'pipedrive', 'custom'),
        allowNull: false,
      },
      credentials: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Encrypted credentials for API access',
      },
      sync_direction: {
        type: Sequelize.ENUM('inbound', 'outbound', 'bidirectional'),
        defaultValue: 'bidirectional',
      },
      last_sync_at: {
        type: Sequelize.DATE,
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
      },
    });

    // Add indexes
    await queryInterface.addIndex('crm_webhooks', ['tenant_key', 'active']);
    await queryInterface.addIndex('crm_webhook_queue', ['webhook_id', 'status']);
    await queryInterface.addIndex('crm_webhook_queue', ['tenant_key', 'status']);
    await queryInterface.addIndex('crm_api_integrations', ['tenant_key', 'provider']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('crm_api_integrations');
    await queryInterface.dropTable('crm_webhook_queue');
    await queryInterface.dropTable('crm_webhooks');
  },
};

/**
 * Migration: Create channel_accounts table (tenant_key-based)
 *
 * Stores channel account connections per tenant (WhatsApp/Instagram/Webchat).
 * `config_encrypted` contains encrypted JSON using api/utils/crypto.js (AES-256-GCM).
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'channel_accounts', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'whatsapp | instagram | webchat',
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active',
        comment: 'active | paused | disabled',
      },
      external_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Identificador externo para roteamento de webhooks (ex: phone_number_id/pageId)',
      },
      config_encrypted: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'JSON criptografado (AES-256-GCM).',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'channel_accounts', ['tenant_key', 'type'], {
      name: 'channel_accounts_tenant_key_type_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_accounts', ['tenant_key', 'status'], {
      name: 'channel_accounts_tenant_key_status_idx',
    });

    await addIndexIfNotExists(queryInterface, 'channel_accounts', ['type', 'external_id'], {
      name: 'channel_accounts_type_external_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('channel_accounts');
  },
};


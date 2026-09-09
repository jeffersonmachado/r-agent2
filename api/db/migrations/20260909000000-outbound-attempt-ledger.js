'use strict';

/**
 * Ledger durável de tentativas de dispatch outbound.
 *
 * Cada tentativa registra: queue item, clientMessageId, provider, início/fim,
 * resultado, externalMessageId, idempotencyKey e classe de erro — antes de
 * chamar o provider (status 'started') e depois do retorno ('completed' /
 * 'failed'). Se o processo cair entre o provider aceitar e o ACK local, a
 * tentativa 'started' órfã é a evidência de ambiguidade que impede retry cego.
 *
 * Sem segredos: nunca armazenar tokens/credenciais em `result`/payloads.
 * Migration idempotente: pode rodar 2x sem erro.
 */

const { indexExists } = require('../migrations-helper');

async function tableExists(queryInterface, tableName) {
  try {
    await queryInterface.describeTable(tableName);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'outbound_attempts'))) {
      await queryInterface.createTable('outbound_attempts', {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        queue_item_id: { type: Sequelize.STRING, allowNull: false },
        client_message_id: { type: Sequelize.STRING(128), allowNull: true },
        channel_type: { type: Sequelize.STRING, allowNull: false },
        provider: { type: Sequelize.STRING, allowNull: false },
        status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'started' },
        result: { type: Sequelize.STRING, allowNull: true },
        external_message_id: { type: Sequelize.STRING, allowNull: true },
        idempotency_key: { type: Sequelize.STRING(256), allowNull: true },
        error_class: { type: Sequelize.STRING, allowNull: true },
        started_at: { type: Sequelize.DATE, allowNull: false },
        completed_at: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!(await indexExists(queryInterface, 'outbound_attempts', 'outbound_attempts_tenant_queue_item_idx'))) {
      await queryInterface.addIndex('outbound_attempts', ['tenant_key', 'queue_item_id'], {
        name: 'outbound_attempts_tenant_queue_item_idx',
      });
    }
    if (!(await indexExists(queryInterface, 'outbound_attempts', 'outbound_attempts_tenant_client_msg_idx'))) {
      await queryInterface.addIndex('outbound_attempts', ['tenant_key', 'client_message_id'], {
        name: 'outbound_attempts_tenant_client_msg_idx',
      });
    }
    if (!(await indexExists(queryInterface, 'outbound_attempts', 'outbound_attempts_status_started_idx'))) {
      await queryInterface.addIndex('outbound_attempts', ['status', 'started_at'], {
        name: 'outbound_attempts_status_started_idx',
      });
    }
  },

  async down(queryInterface) {
    try { await queryInterface.dropTable('outbound_attempts'); } catch {}
  },
};

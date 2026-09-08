'use strict';

/**
 * Idempotência end-to-end do envio de mensagens do Inbox.
 *
 * Objetivo:
 * - Persistir o `client_message_id` (chave de idempotência estável gerada no
 *   cliente) em `channel_messages` e `outbound_queue`.
 * - Garantir via UNIQUE parcial `(tenant_key, client_message_id)` que retries
 *   (rede, PWA restart, double-click) não dupliquem mensagem nem item de fila.
 *
 * Notas:
 * - Índices são parciais (client_message_id IS NOT NULL) para permitir múltiplos
 *   NULLs (mensagens inbound e chamadores legados sem a chave).
 * - Migration idempotente: pode rodar 2x sem erro.
 */

const { indexExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  try {
    const desc = await queryInterface.describeTable(tableName);
    return !!desc[columnName];
  } catch {
    return false;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ---------------------------------------------------------------------
    // channel_messages: client_message_id + unique(tenant_key, client_message_id)
    // ---------------------------------------------------------------------
    if (!(await columnExists(queryInterface, 'channel_messages', 'client_message_id'))) {
      await queryInterface.addColumn('channel_messages', 'client_message_id', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }

    const messagesIndexName = 'channel_messages_tenant_client_msg_id_uq';
    if (!(await indexExists(queryInterface, 'channel_messages', messagesIndexName))) {
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX ${messagesIndexName}
        ON channel_messages (tenant_key, client_message_id)
        WHERE client_message_id IS NOT NULL
        `
      );
    }

    // ---------------------------------------------------------------------
    // outbound_queue: client_message_id + unique(tenant_key, client_message_id)
    // ---------------------------------------------------------------------
    if (!(await columnExists(queryInterface, 'outbound_queue', 'client_message_id'))) {
      await queryInterface.addColumn('outbound_queue', 'client_message_id', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }

    const outqIndexName = 'outbound_queue_tenant_client_msg_id_uq';
    if (!(await indexExists(queryInterface, 'outbound_queue', outqIndexName))) {
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX ${outqIndexName}
        ON outbound_queue (tenant_key, client_message_id)
        WHERE client_message_id IS NOT NULL
        `
      );
    }
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('outbound_queue', 'outbound_queue_tenant_client_msg_id_uq'); } catch {}
    try { await queryInterface.removeIndex('channel_messages', 'channel_messages_tenant_client_msg_id_uq'); } catch {}
    try { await queryInterface.removeColumn('outbound_queue', 'client_message_id'); } catch {}
    try { await queryInterface.removeColumn('channel_messages', 'client_message_id'); } catch {}
  },
};

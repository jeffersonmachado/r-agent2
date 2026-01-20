'use strict';

/**
 * Hardening: DB idempotência REAL via UNIQUE.
 *
 * Objetivo:
 * - Garantir que mensagens com o mesmo external_message_id não sejam duplicadas no banco.
 * - Tornar a chave de idempotência tenant-aware e channel-aware.
 *
 * Notas:
 * - Este projeto usa `tenant_key` (não `tenant_id`) nas tabelas.
 * - `channel_messages` não possuía `channel_type`; adicionamos e backfill via `channel_conversations`.
 * - Índices UNIQUE são parciais (external_message_id IS NOT NULL) para permitir múltiplos NULLs.
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
    // channel_messages: add channel_type + unique(tenant_key, channel_type, external_message_id)
    // ---------------------------------------------------------------------
    if (await columnExists(queryInterface, 'channel_messages', 'channel_type')) {
      // ok
    } else {
      await queryInterface.addColumn('channel_messages', 'channel_type', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }

    // Backfill channel_type via join com channel_conversations
    // e garante valor para linhas órfãs (evita NOT NULL falhar).
    await queryInterface.sequelize.query(
      `
      UPDATE channel_messages cm
      SET channel_type = cc.channel_type
      FROM channel_conversations cc
      WHERE cm.conversation_id = cc.id
        AND (cm.channel_type IS NULL OR cm.channel_type = '')
      `
    );
    await queryInterface.sequelize.query(
      `
      UPDATE channel_messages
      SET channel_type = 'unknown'
      WHERE channel_type IS NULL OR channel_type = ''
      `
    );

    // Enforce NOT NULL (best-effort)
    try {
      await queryInterface.changeColumn('channel_messages', 'channel_type', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'unknown',
      });
    } catch (_) {}

    // Remove índice único antigo (tenant_key, external_message_id) para permitir re-criar com channel_type
    const oldIndexName = 'channel_messages_tenant_external_msg_id_uq';
    if (await indexExists(queryInterface, 'channel_messages', oldIndexName)) {
      try {
        await queryInterface.removeIndex('channel_messages', oldIndexName);
      } catch (_) {}
    }

    const newIndexName = 'channel_messages_tenant_channel_type_external_msg_id_uq';
    if (!(await indexExists(queryInterface, 'channel_messages', newIndexName))) {
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX ${newIndexName}
        ON channel_messages (tenant_key, channel_type, external_message_id)
        WHERE external_message_id IS NOT NULL
        `
      );
    }

    // ---------------------------------------------------------------------
    // outbound_queue: unique(tenant_key, channel_type, external_message_id) quando não null
    // ---------------------------------------------------------------------
    const outqIndexName = 'outbound_queue_tenant_channel_type_external_msg_id_uq';
    if (!(await indexExists(queryInterface, 'outbound_queue', outqIndexName))) {
      await queryInterface.sequelize.query(
        `
        CREATE UNIQUE INDEX ${outqIndexName}
        ON outbound_queue (tenant_key, channel_type, external_message_id)
        WHERE external_message_id IS NOT NULL
        `
      );
    }
  },

  async down(queryInterface) {
    // Best-effort down: remove novos índices/coluna
    try { await queryInterface.removeIndex('outbound_queue', 'outbound_queue_tenant_channel_type_external_msg_id_uq'); } catch {}
    try { await queryInterface.removeIndex('channel_messages', 'channel_messages_tenant_channel_type_external_msg_id_uq'); } catch {}
    // Não recria o índice antigo automaticamente.
    try { await queryInterface.removeColumn('channel_messages', 'channel_type'); } catch {}
  },
};


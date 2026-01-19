/**
 * Migration: Enforce 1 open ticket per conversation (tenant-scoped)
 *
 * Rationale:
 * - Fase 2 exige amarração 1:1 conversa ↔ ticket.
 * - A lógica de runtime (cache) pode sofrer concorrência/retries de webhook.
 * - Este índice partial UNIQUE garante no Postgres:
 *   - para um dado (tenant_key, conversation_id), existe no máximo 1 ticket com status != 'closed'
 *   - tickets sem conversation_id (legado) não são afetados
 */

'use strict';

module.exports = {
  async up(queryInterface) {
    // Índice parcial (Postgres)
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS tickets_tenant_conv_open_uq
       ON tickets (tenant_key, conversation_id)
       WHERE conversation_id IS NOT NULL AND status <> 'closed'`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS tickets_tenant_conv_open_uq'
    );
  },
};


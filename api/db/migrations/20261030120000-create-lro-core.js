'use strict';

/**
 * Núcleo de LRO (Long-Running Operations) — Fase 1 do mandato.
 *
 * Cria as três tabelas que faltavam para uma operação longa ter estado DURÁVEL e rastreável:
 *   lro_operations — entidade autoritativa (status/fase/progresso/lease/fencing/desfecho);
 *   lro_events     — log append-only com sequência monotônica por operação (base do replay do SSE);
 *   lro_outbox     — fila transacional (estado + evento no mesmo commit).
 *
 * Por que existe (`docs/architecture/lro-qa-waves.md` §2/§3): a execução do QA Waves vive num `Map`
 * de processo (`qa-mesh/executionQueue.js:5`) — reinício perde o histórico, segunda instância não
 * enxerga nada e não há como reidratar a UI após reconexão.
 *
 * Desenho de lease/fencing COPIADO de `engineering_tasks` (migrations 20260924/20260925) em vez de
 * inventar semântica nova: `lease_owner` + `lease_expires_at` + `fencing_token` monotônico.
 *
 * Reversível: `down` remove na ordem inversa das FKs e antes remove os índices implícitos das tabelas.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('lro_operations', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      owner_actor_id: { type: DataTypes.STRING(120), allowNull: true },
      operation_type: { type: DataTypes.STRING(80), allowNull: false },
      visibility_class: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'DEVELOPMENT' },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'CREATED' },
      phase: { type: DataTypes.STRING(80), allowNull: true },

      progress_current: { type: DataTypes.INTEGER, allowNull: true },
      progress_total: { type: DataTypes.INTEGER, allowNull: true },
      progress_unit: { type: DataTypes.STRING(24), allowNull: true },
      progress_revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      message_code: { type: DataTypes.STRING(80), allowNull: true },
      result_ref: { type: DataTypes.STRING(512), allowNull: true },
      outcome: { type: DataTypes.STRING(20), allowNull: true },
      error_code: { type: DataTypes.STRING(80), allowNull: true },
      feedback_request_id: { type: DataTypes.STRING(80), allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      started_at: { type: DataTypes.DATE, allowNull: true },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      heartbeat_at: { type: DataTypes.DATE, allowNull: true },

      checkpoint_ref: { type: DataTypes.STRING(512), allowNull: true },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      lease_owner: { type: DataTypes.STRING(160), allowNull: true },
      lease_expires_at: { type: DataTypes.DATE, allowNull: true },
      fencing_token: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      correlation_id: { type: DataTypes.STRING(80), allowNull: true },
      idempotency_key: { type: DataTypes.STRING(200), allowNull: true },
      retention_policy: { type: DataTypes.STRING(40), allowNull: true },
    });

    await queryInterface.addIndex('lro_operations', ['tenant_id', 'created_at'], {
      name: 'lro_operations_tenant_created_idx',
    });
    await queryInterface.addIndex('lro_operations', ['status', 'updated_at'], {
      name: 'lro_operations_status_updated_idx',
    });
    await queryInterface.addIndex('lro_operations', ['lease_expires_at'], {
      name: 'lro_operations_lease_expires_idx',
    });
    await queryInterface.addIndex('lro_operations', ['tenant_id', 'idempotency_key'], {
      name: 'lro_operations_tenant_idempotency_uniq',
      unique: true,
      // Idempotência só vale quando a chave existe: sem isso, todo NULL colidiria.
      where: { idempotency_key: { [Sequelize.Op.ne]: null } },
    });

    await queryInterface.createTable('lro_events', {
      id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      operation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'lro_operations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      seq: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.STRING(80), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      actor_id: { type: DataTypes.STRING(120), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    // Sequência monotônica POR operação: é o que o SSE usa como Last-Event-ID.
    await queryInterface.addIndex('lro_events', ['operation_id', 'seq'], {
      name: 'lro_events_operation_seq_uniq',
      unique: true,
    });

    await queryInterface.createTable('lro_outbox', {
      id: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true },
      operation_id: { type: DataTypes.UUID, allowNull: true },
      event_id: { type: DataTypes.BIGINT, allowNull: true },
      topic: { type: DataTypes.STRING(120), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      available_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      published_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('lro_outbox', ['status', 'available_at'], {
      name: 'lro_outbox_status_available_idx',
    });
  },

  async down(queryInterface) {
    // Ordem inversa das FKs: eventos antes da operação; outbox é independente.
    await queryInterface.dropTable('lro_outbox');
    await queryInterface.dropTable('lro_events');
    await queryInterface.dropTable('lro_operations');
  },
};

'use strict';

/**
 * Feedback humano de operações longas (mandato LRO §7).
 *
 * `WAITING_FEEDBACK` só existe com uma SOLICITAÇÃO identificada — e a resposta precisa provar
 * tenant, autorização, versão da operação, prazo e idempotência. Silêncio/timeout NUNCA é aprovação:
 * por isso o prazo é coluna (`deadline_at`) e existe estado `EXPIRED`.
 *
 * Reversível: `down` remove as respostas antes das solicitações (FK) e depois as solicitações.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('lro_feedback_requests', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      operation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'lro_operations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      requested_by: { type: DataTypes.STRING(120), allowNull: true },
      assignee_actor_id: { type: DataTypes.STRING(120), allowNull: true },
      assignee_role: { type: DataTypes.STRING(80), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
      options: { type: DataTypes.JSONB, allowNull: true },
      response_schema: { type: DataTypes.JSONB, allowNull: true },
      /** Versão da operação NO MOMENTO da solicitação: resposta sobre versão velha é recusada. */
      operation_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      deadline_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    await queryInterface.addIndex('lro_feedback_requests', ['operation_id', 'status'], {
      name: 'lro_feedback_requests_operation_status_idx',
    });
    await queryInterface.addIndex('lro_feedback_requests', ['tenant_id', 'status'], {
      name: 'lro_feedback_requests_tenant_status_idx',
    });

    await queryInterface.createTable('lro_feedback_responses', {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      request_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'lro_feedback_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      operation_id: { type: DataTypes.UUID, allowNull: false },
      tenant_id: { type: DataTypes.STRING(120), allowNull: false },
      actor_id: { type: DataTypes.STRING(120), allowNull: true },
      decision: { type: DataTypes.STRING(40), allowNull: false },
      option_id: { type: DataTypes.STRING(80), allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: true },
      operation_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      idempotency_key: { type: DataTypes.STRING(200), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });

    // Uma resposta por (solicitação, chave de idempotência): reenvio não duplica efeito.
    await queryInterface.addIndex('lro_feedback_responses', ['request_id', 'idempotency_key'], {
      name: 'lro_feedback_responses_request_idem_uniq',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('lro_feedback_responses');
    await queryInterface.dropTable('lro_feedback_requests');
  },
};

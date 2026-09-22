/**
 * Migration: cria engineering_operations.
 *
 * ER-V1-SEAL-002 (Full Durable Resume): registro idempotente por EFEITO COLATERAL real de cada
 * fase do Engineering Router (model call, test run, review, regression, governance, promotion,
 * post-promotion verify) — distinto de `EngineeringTestRun`/`EngineeringReview`/
 * `EngineeringRegressionRun` (que já guardam a EVIDÊNCIA de cada execução): esta tabela guarda o
 * CONTROLE de idempotência em si (já rodei este efeito para esta task/attempt/fase com esta
 * chave? qual o resultado?), permitindo ao reconciliador decidir RESUME/RETRY/RECONCILE/
 * FAIL_SAFE/MANUAL_REQUIRED sem re-executar um efeito colateral não idempotente (chamada real de
 * IA, commit real, etc.) depois de um crash e restart.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_operations', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      task_id: { type: Sequelize.UUID, allowNull: false },
      attempt_id: { type: Sequelize.UUID, allowNull: true },
      phase: { type: Sequelize.STRING, allowNull: false },
      idempotency_key: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false },
      evidence_ref: { type: Sequelize.JSONB, allowNull: true },
      result_hash: { type: Sequelize.STRING, allowNull: true },
      error: { type: Sequelize.JSONB, allowNull: true },
      started_at: { type: Sequelize.DATE, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'engineering_operations', ['idempotency_key'], {
      name: 'engineering_operations_idempotency_key_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'engineering_operations', ['task_id'], { name: 'engineering_operations_task_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_operations', ['attempt_id'], { name: 'engineering_operations_attempt_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_operations').catch(() => {});
  },
};

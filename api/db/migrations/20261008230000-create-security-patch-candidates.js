'use strict';

/**
 * Migration: candidatos de correção da inteligência de segurança.
 *
 * Um candidato é o PLANO de correção de um achado (o que atualizar, de qual
 * versão para qual, com que risco e pré-condições). Ele é separado do achado de
 * propósito: um achado é um FATO sobre o presente; um candidato é uma PROPOSTA,
 * e propostas precisam de estado próprio (proposto → missão criada → validado →
 * aplicado/rejeitado).
 *
 * `mission_id` liga o candidato à missão do Roteador Engenheiro que executa a
 * validação em ambiente isolado — a correção nunca é aplicada por este módulo.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'security_patch_candidates', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      candidate_key: { type: Sequelize.STRING, allowNull: false },
      finding_key: { type: Sequelize.STRING, allowNull: false },
      advisory_id: { type: Sequelize.STRING, allowNull: true },
      ecosystem: { type: Sequelize.STRING, allowNull: true },
      package_name: { type: Sequelize.STRING, allowNull: false },
      service: { type: Sequelize.STRING, allowNull: true },
      current_version: { type: Sequelize.STRING, allowNull: true },
      target_version: { type: Sequelize.STRING, allowNull: true },
      kind: { type: Sequelize.STRING, allowNull: false },
      update_risk: { type: Sequelize.STRING, allowNull: false, defaultValue: 'UNKNOWN' },
      autonomy: { type: Sequelize.STRING, allowNull: false, defaultValue: 'LEVEL_C_PRODUCTION' },
      requires_human_approval: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      severity: { type: Sequelize.STRING, allowNull: true },
      kev: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      dev_only: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'PROPOSED' },
      preconditions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      rationale: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      mission_id: { type: Sequelize.UUID, allowNull: true },
      mission_requested_at: { type: Sequelize.DATE, allowNull: true },
      mission_requested_by: { type: Sequelize.STRING, allowNull: true },
      plan: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_patch_candidates', ['tenant_key', 'candidate_key'], {
      unique: true,
      name: 'security_patch_candidates_tenant_key_unique',
    });
    await addIndexIfNotExists(queryInterface, 'security_patch_candidates', ['tenant_key', 'status', 'severity'], {
      name: 'security_patch_candidates_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'security_patch_candidates', ['finding_key'], {
      name: 'security_patch_candidates_finding_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('security_patch_candidates').catch(() => {});
  },
};

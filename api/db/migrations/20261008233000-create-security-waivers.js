'use strict';

/**
 * Migration: waivers auditáveis da inteligência de segurança.
 *
 * Um waiver é a ACEITAÇÃO FORMAL de um risco conhecido por um humano
 * identificado, com motivo declarado e **expiração obrigatória**. Sem esta
 * tabela, `security_findings.waiver_id` era uma referência pendente e o motor de
 * risco nunca conseguia marcar `MITIGATED` — o gate apenas reprovava.
 *
 * Decisões de schema que carregam política (não são detalhe):
 *   - `expires_at` é NOT NULL: isenção perpétua não é representável. O gate
 *     também recusa waiver sem expiração, mas a garantia forte mora aqui;
 *   - `reason` e `approved_by` são NOT NULL: "aceitar risco" sem quem aceitou e
 *     por quê não é auditável;
 *   - `revoked_at`/`revoked_by`/`revoke_reason` permitem revogar sem apagar
 *     (histórico é evidência, DELETE não é);
 *   - nada nesta migração isenta nada: a tabela nasce VAZIA.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'security_waivers', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      waiver_key: { type: Sequelize.STRING, allowNull: false },
      finding_key: { type: Sequelize.STRING, allowNull: false },
      advisory_id: { type: Sequelize.STRING, allowNull: true },
      package_name: { type: Sequelize.STRING, allowNull: true },
      service: { type: Sequelize.STRING, allowNull: true },
      severity: { type: Sequelize.STRING, allowNull: true },
      // Motivo é obrigatório: "aceitamos o risco" sem justificativa é ruído.
      reason: { type: Sequelize.TEXT, allowNull: false },
      compensating_control: { type: Sequelize.TEXT, allowNull: true },
      approved_by: { type: Sequelize.STRING, allowNull: false },
      created_by: { type: Sequelize.STRING, allowNull: true },
      // Expiração obrigatória (ver comentário do topo).
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      revoked_by: { type: Sequelize.STRING, allowNull: true },
      revoke_reason: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'security_waivers', ['tenant_key', 'waiver_key'], {
      unique: true,
      name: 'security_waivers_tenant_key_unique',
    });
    await addIndexIfNotExists(queryInterface, 'security_waivers', ['tenant_key', 'finding_key'], {
      name: 'security_waivers_finding_idx',
    });
    await addIndexIfNotExists(queryInterface, 'security_waivers', ['expires_at'], {
      name: 'security_waivers_expires_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('security_waivers').catch(() => {});
  },
};

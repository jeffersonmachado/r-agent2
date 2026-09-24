'use strict';

/**
 * Migration: reviews persistidos da missão (Meta Reviewer §23 + Adversarial Review §24).
 *
 * Uma tabela só, com `kind` — as duas revisões compartilham o mesmo contrato de findings
 * (id/checkId/severity/status/evidence/blocksGreen), então duplicar tabela seria duplicar
 * infraestrutura (proibido pela missão).
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_mission_reviews', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      mission_id: { type: Sequelize.UUID, allowNull: false },
      mission_version: { type: Sequelize.INTEGER, allowNull: false },
      spec_hash: { type: Sequelize.STRING, allowNull: true },
      kind: { type: Sequelize.STRING, allowNull: false, defaultValue: 'META' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'INCOMPLETE' },
      blocks_green: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      counts: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      findings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      engine_version: { type: Sequelize.STRING, allowNull: false },
      actor: { type: Sequelize.STRING, allowNull: true },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'engineering_mission_reviews', ['mission_id', 'mission_version', 'kind'], { name: 'engineering_mission_reviews_lookup_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_mission_reviews', ['idempotency_key'], { unique: true, name: 'engineering_mission_reviews_idempotency_key_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_mission_reviews').catch(() => {});
  },
};

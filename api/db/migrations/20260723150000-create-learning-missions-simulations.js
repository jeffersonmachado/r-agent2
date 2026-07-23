'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'learning_missions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: true },
      journey_key: { type: Sequelize.STRING, allowNull: true },
      title: { type: Sequelize.STRING, allowNull: false },
      summary: { type: Sequelize.TEXT, allowNull: true },
      rag_document_id: { type: Sequelize.STRING, allowNull: true },
      replay_id: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'available' },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      completed_by: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_missions', ['tenant_id', 'agent_id', 'status'], { name: 'lm_tenant_agent_status_idx' });
    await addIndexIfNotExists(queryInterface, 'learning_missions', ['tenant_id', 'journey_key'], { name: 'lm_tenant_journey_idx' });

    await createTableIfNotExists(queryInterface, 'learning_simulations', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      journey_key: { type: Sequelize.STRING, allowNull: false },
      seed_type: { type: Sequelize.STRING, allowNull: false },
      persona_key: { type: Sequelize.STRING, allowNull: false },
      scenario: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      ai_enrichment: { type: Sequelize.JSONB, allowNull: true },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'generated' },
      result: { type: Sequelize.JSONB, allowNull: true },
      created_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_simulations', ['tenant_id', 'journey_key'], { name: 'ls_tenant_journey_idx' });
    await addIndexIfNotExists(queryInterface, 'learning_simulations', ['tenant_id', 'created_at'], { name: 'ls_tenant_created_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_simulations').catch(() => {});
    await queryInterface.dropTable('learning_missions').catch(() => {});
  },
};

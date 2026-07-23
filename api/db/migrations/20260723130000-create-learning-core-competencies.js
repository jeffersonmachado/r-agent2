'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'user_competencies', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      skill_key: { type: Sequelize.STRING, allowNull: false },
      score: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
      components: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      evidence_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      event_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      first_seen_at: { type: Sequelize.DATE, allowNull: true },
      last_seen_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'user_competencies', ['tenant_id', 'agent_id', 'skill_key'], { name: 'uc_tenant_agent_skill_uq', unique: true });
    await addIndexIfNotExists(queryInterface, 'user_competencies', ['tenant_id', 'skill_key'], { name: 'uc_tenant_skill_idx' });

    await createTableIfNotExists(queryInterface, 'user_learning_profiles', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      computed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'user_learning_profiles', ['tenant_id', 'agent_id'], { name: 'ulp_tenant_agent_uq', unique: true });

    await createTableIfNotExists(queryInterface, 'learning_route_skill_map', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      route: { type: Sequelize.STRING, allowNull: false },
      skill_key: { type: Sequelize.STRING, allowNull: false },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'static' },
      confidence: { type: Sequelize.FLOAT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_route_skill_map', ['tenant_id', 'route'], { name: 'lrsm_tenant_route_uq', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_route_skill_map').catch(() => {});
    await queryInterface.dropTable('user_learning_profiles').catch(() => {});
    await queryInterface.dropTable('user_competencies').catch(() => {});
  },
};

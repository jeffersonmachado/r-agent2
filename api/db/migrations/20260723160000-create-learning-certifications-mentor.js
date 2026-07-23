'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'user_certifications', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      skill_key: { type: Sequelize.STRING, allowNull: false },
      level: { type: Sequelize.STRING, allowNull: false, defaultValue: 'operacional' },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      assessment_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      evidence_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      issued_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      revoke_reason: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'user_certifications', ['tenant_id', 'agent_id', 'skill_key'], { name: 'uc_tenant_agent_skill_idx' });
    await addIndexIfNotExists(queryInterface, 'user_certifications', ['tenant_id', 'agent_id', 'status'], { name: 'uc_tenant_agent_status_idx' });

    await createTableIfNotExists(queryInterface, 'learning_mentor_plans', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      aggregates: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      plan: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      generated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_mentor_plans', ['tenant_id', 'agent_id', 'generated_at'], { name: 'lmp_tenant_agent_generated_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_mentor_plans').catch(() => {});
    await queryInterface.dropTable('user_certifications').catch(() => {});
  },
};

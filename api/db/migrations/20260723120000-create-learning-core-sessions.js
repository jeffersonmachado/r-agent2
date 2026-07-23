'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'user_interaction_sessions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      username: { type: Sequelize.STRING, allowNull: true },
      session_id: { type: Sequelize.STRING, allowNull: false },
      started_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      event_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      routes_visited: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'user_interaction_sessions', ['tenant_id', 'agent_id'], { name: 'uis_tenant_agent_idx' });
    await addIndexIfNotExists(queryInterface, 'user_interaction_sessions', ['tenant_id', 'session_id'], { name: 'uis_tenant_session_idx', unique: true });
    await addIndexIfNotExists(queryInterface, 'user_interaction_sessions', ['tenant_id', 'last_seen_at'], { name: 'uis_tenant_last_seen_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_interaction_sessions').catch(() => {});
  },
};

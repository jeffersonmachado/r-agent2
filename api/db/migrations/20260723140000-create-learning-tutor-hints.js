'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'learning_tutor_hints', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      agent_id: { type: Sequelize.STRING, allowNull: false },
      session_id: { type: Sequelize.STRING, allowNull: true },
      route: { type: Sequelize.STRING, allowNull: false },
      level: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      trigger: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      hint_text: { type: Sequelize.TEXT, allowNull: false },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'rag' },
      evidence_refs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_tutor_hints', ['tenant_id', 'agent_id', 'route', 'created_at'], { name: 'lth_tenant_agent_route_idx' });
    await addIndexIfNotExists(queryInterface, 'learning_tutor_hints', ['tenant_id', 'route', 'created_at'], { name: 'lth_tenant_route_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_tutor_hints').catch(() => {});
  },
};

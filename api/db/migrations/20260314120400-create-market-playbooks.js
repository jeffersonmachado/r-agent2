'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'market_playbooks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      vertical: { type: Sequelize.STRING(120), allowNull: false },
      problem_type: { type: Sequelize.STRING(80), allowNull: false },
      playbook_name: { type: Sequelize.STRING(180), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      success_rate: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0 },
      evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'market_playbooks', ['vertical'], { name: 'market_playbooks_vertical_idx' });
    await addIndexIfNotExists(queryInterface, 'market_playbooks', ['vertical', 'problem_type'], { name: 'market_playbooks_vertical_problem_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('market_playbooks').catch(() => {});
  },
};

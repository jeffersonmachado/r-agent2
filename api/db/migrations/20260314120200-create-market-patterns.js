'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'market_patterns', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      vertical: { type: Sequelize.STRING(120), allowNull: false },
      pattern_type: { type: Sequelize.STRING(80), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      confidence: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      detected_at: { type: Sequelize.DATE, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'market_patterns', ['vertical'], { name: 'market_patterns_vertical_idx' });
    await addIndexIfNotExists(queryInterface, 'market_patterns', ['vertical', 'pattern_type'], { name: 'market_patterns_vertical_type_idx' });
    await addIndexIfNotExists(queryInterface, 'market_patterns', ['detected_at'], { name: 'market_patterns_detected_at_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('market_patterns').catch(() => {});
  },
};

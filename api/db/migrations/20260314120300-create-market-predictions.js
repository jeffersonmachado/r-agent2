'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'market_predictions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      prediction_type: { type: Sequelize.STRING(80), allowNull: false },
      target_metric: { type: Sequelize.STRING(120), allowNull: false },
      predicted_value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      confidence: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      prediction_window: { type: Sequelize.STRING(80), allowNull: false },
      evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      generated_at: { type: Sequelize.DATE, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'market_predictions', ['tenant_key'], { name: 'market_predictions_tenant_key_idx' });
    await addIndexIfNotExists(queryInterface, 'market_predictions', ['tenant_key', 'prediction_type', 'target_metric'], { name: 'market_predictions_lookup_idx' });
    await addIndexIfNotExists(queryInterface, 'market_predictions', ['generated_at'], { name: 'market_predictions_generated_at_idx' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('market_predictions').catch(() => {});
  },
};

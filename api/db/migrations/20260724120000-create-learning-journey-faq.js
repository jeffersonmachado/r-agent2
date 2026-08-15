'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'learning_journey_faqs', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      journey_key: { type: Sequelize.STRING, allowNull: false },
      fingerprint: { type: Sequelize.STRING, allowNull: false },
      category: { type: Sequelize.STRING, allowNull: false },
      question: { type: Sequelize.TEXT, allowNull: false },
      answer: { type: Sequelize.TEXT, allowNull: false },
      sources: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'suggested' },
      current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      curated_by: { type: Sequelize.STRING, allowNull: true },
      curated_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'learning_journey_faqs', ['tenant_id', 'journey_key'], { name: 'ljf_tenant_journey_idx' });
    await addIndexIfNotExists(queryInterface, 'learning_journey_faqs', ['tenant_id', 'journey_key', 'status'], { name: 'ljf_tenant_journey_status_idx' });
    await addIndexIfNotExists(queryInterface, 'learning_journey_faqs', ['tenant_id', 'journey_key', 'fingerprint'], { name: 'ljf_tenant_journey_fingerprint_uk', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learning_journey_faqs').catch(() => {});
  },
};

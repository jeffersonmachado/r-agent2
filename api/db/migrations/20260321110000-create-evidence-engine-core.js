'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'evidence', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      entity_type: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.STRING, allowNull: false },
      related_entities: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      source_type: { type: Sequelize.STRING, allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: false },
      source_ref: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      category: { type: Sequelize.STRING, allowNull: false, defaultValue: 'support' },
      type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'confirmation' },
      theme: { type: Sequelize.STRING, allowNull: true },
      summary: { type: Sequelize.STRING, allowNull: false },
      excerpt: { type: Sequelize.TEXT, allowNull: true },
      normalized_text: { type: Sequelize.TEXT, allowNull: true },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      indexed_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      confidence: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0.5 },
      strength: { type: Sequelize.STRING, allowNull: false, defaultValue: 'moderate' },
      actor_type: { type: Sequelize.STRING, allowNull: true },
      actor_id: { type: Sequelize.STRING, allowNull: true },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      idempotency_key: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'entity_type', 'entity_id', 'occurred_at'], {
      name: 'evidence_tenant_entity_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'category', 'occurred_at'], {
      name: 'evidence_tenant_category_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'type', 'occurred_at'], {
      name: 'evidence_tenant_type_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'theme', 'occurred_at'], {
      name: 'evidence_tenant_theme_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'source_type', 'source_id'], {
      name: 'evidence_tenant_source_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'occurred_at'], {
      name: 'evidence_tenant_occurred_idx',
    });
    await addIndexIfNotExists(queryInterface, 'evidence', ['tenant_key', 'idempotency_key'], {
      name: 'evidence_tenant_idempotency_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('evidence').catch(() => {});
  },
};

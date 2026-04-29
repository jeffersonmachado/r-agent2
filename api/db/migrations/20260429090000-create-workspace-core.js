'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'workspace_entities', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false, defaultValue: 'contact' },
      name: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: true },
      email: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'workspace_timeline_events', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      ref_id: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'workspace_insights', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      confidence: { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0.5 },
      source: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await createTableIfNotExists(queryInterface, 'workspace_actions', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      entity_id: { type: Sequelize.UUID, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'pending' },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'workspace_entities', ['tenant_id', 'type'], { name: 'workspace_entities_tenant_type_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_entities', ['tenant_id', 'phone'], { name: 'workspace_entities_tenant_phone_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_entities', ['tenant_id', 'email'], { name: 'workspace_entities_tenant_email_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_entities', ['tenant_id', 'created_at'], { name: 'workspace_entities_tenant_created_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_timeline_events', ['tenant_id', 'entity_id', 'created_at'], { name: 'workspace_timeline_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_timeline_events', ['tenant_id', 'type', 'created_at'], { name: 'workspace_timeline_tenant_type_created_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_timeline_events', ['tenant_id', 'type', 'ref_id'], { name: 'workspace_timeline_tenant_type_ref_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_insights', ['tenant_id', 'entity_id', 'created_at'], { name: 'workspace_insights_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_insights', ['tenant_id', 'type'], { name: 'workspace_insights_tenant_type_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_actions', ['tenant_id', 'entity_id', 'created_at'], { name: 'workspace_actions_tenant_entity_created_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_actions', ['tenant_id', 'status'], { name: 'workspace_actions_tenant_status_idx' });
    await addIndexIfNotExists(queryInterface, 'workspace_actions', ['tenant_id', 'type'], { name: 'workspace_actions_tenant_type_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('workspace_actions').catch(() => {});
    await queryInterface.dropTable('workspace_insights').catch(() => {});
    await queryInterface.dropTable('workspace_timeline_events').catch(() => {});
    await queryInterface.dropTable('workspace_entities').catch(() => {});
  },
};

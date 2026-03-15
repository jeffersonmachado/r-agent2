'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_goals', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(180), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      metric_key: { type: Sequelize.STRING(120), allowNull: false },
      target_value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      current_value: { type: Sequelize.DECIMAL(18, 6), allowNull: true },
      comparison_mode: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'gte' },
      period_type: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'month' },
      start_date: { type: Sequelize.DATEONLY, allowNull: true },
      end_date: { type: Sequelize.DATEONLY, allowNull: true },
      priority: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'active' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'tenant_goals', ['tenant_key'], {
      name: 'tenant_goals_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_goals', ['tenant_key', 'status'], {
      name: 'tenant_goals_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_goals', ['tenant_key', 'period_type'], {
      name: 'tenant_goals_tenant_period_type_idx',
    });

    await createTableIfNotExists(queryInterface, 'tenant_metric_snapshots', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      metric_key: { type: Sequelize.STRING(120), allowNull: false },
      value: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      period_start: { type: Sequelize.DATE, allowNull: false },
      period_end: { type: Sequelize.DATE, allowNull: false },
      dimensions: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      source: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'event_ledger' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'tenant_metric_snapshots', ['tenant_key'], {
      name: 'tenant_metric_snapshots_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_metric_snapshots', ['tenant_key', 'metric_key', 'period_start'], {
      name: 'tenant_metric_snapshots_tenant_metric_period_start_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_metric_snapshots', ['tenant_key', 'period_start', 'period_end'], {
      name: 'tenant_metric_snapshots_tenant_period_idx',
    });

    await createTableIfNotExists(queryInterface, 'tenant_insights', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING(80), allowNull: false },
      title: { type: Sequelize.STRING(220), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      confidence: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.5 },
      impact: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'open' },
      period_start: { type: Sequelize.DATE, allowNull: true },
      period_end: { type: Sequelize.DATE, allowNull: true },
      source: { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'tenant_intelligence' },
      related_metrics: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'tenant_insights', ['tenant_key'], {
      name: 'tenant_insights_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_insights', ['tenant_key', 'status'], {
      name: 'tenant_insights_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_insights', ['tenant_key', 'period_start', 'period_end'], {
      name: 'tenant_insights_tenant_period_idx',
    });

    await createTableIfNotExists(queryInterface, 'tenant_insight_evidences', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      insight_id: { type: Sequelize.STRING, allowNull: false },
      evidence_type: { type: Sequelize.STRING(80), allowNull: false },
      source_type: { type: Sequelize.STRING(80), allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: true },
      excerpt: { type: Sequelize.TEXT, allowNull: true },
      structured_data: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'tenant_insight_evidences', ['tenant_key'], {
      name: 'tenant_insight_evidences_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_insight_evidences', ['tenant_key', 'insight_id'], {
      name: 'tenant_insight_evidences_tenant_insight_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_insight_evidences', ['tenant_key', 'source_type', 'source_id'], {
      name: 'tenant_insight_evidences_tenant_source_idx',
    });

    await createTableIfNotExists(queryInterface, 'tenant_recommendations', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      insight_id: { type: Sequelize.STRING, allowNull: true },
      goal_id: { type: Sequelize.STRING, allowNull: true },
      title: { type: Sequelize.STRING(220), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      action_type: { type: Sequelize.STRING(80), allowNull: false },
      priority: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'open' },
      estimated_impact: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'tenant_recommendations', ['tenant_key'], {
      name: 'tenant_recommendations_tenant_key_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_recommendations', ['tenant_key', 'status'], {
      name: 'tenant_recommendations_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_recommendations', ['tenant_key', 'insight_id'], {
      name: 'tenant_recommendations_tenant_insight_idx',
    });
    await addIndexIfNotExists(queryInterface, 'tenant_recommendations', ['tenant_key', 'goal_id'], {
      name: 'tenant_recommendations_tenant_goal_idx',
    });

    await queryInterface.addConstraint('tenant_insight_evidences', {
      fields: ['insight_id'],
      type: 'foreign key',
      name: 'tenant_insight_evidences_insight_id_fk',
      references: { table: 'tenant_insights', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    }).catch(() => {});

    await queryInterface.addConstraint('tenant_recommendations', {
      fields: ['insight_id'],
      type: 'foreign key',
      name: 'tenant_recommendations_insight_id_fk',
      references: { table: 'tenant_insights', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch(() => {});

    await queryInterface.addConstraint('tenant_recommendations', {
      fields: ['goal_id'],
      type: 'foreign key',
      name: 'tenant_recommendations_goal_id_fk',
      references: { table: 'tenant_goals', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('tenant_recommendations', 'tenant_recommendations_goal_id_fk').catch(() => {});
    await queryInterface.removeConstraint('tenant_recommendations', 'tenant_recommendations_insight_id_fk').catch(() => {});
    await queryInterface.removeConstraint('tenant_insight_evidences', 'tenant_insight_evidences_insight_id_fk').catch(() => {});

    await queryInterface.dropTable('tenant_recommendations').catch(() => {});
    await queryInterface.dropTable('tenant_insight_evidences').catch(() => {});
    await queryInterface.dropTable('tenant_insights').catch(() => {});
    await queryInterface.dropTable('tenant_metric_snapshots').catch(() => {});
    await queryInterface.dropTable('tenant_goals').catch(() => {});
  },
};

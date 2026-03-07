'use strict';

const {
  createTableIfNotExists,
  addIndexIfNotExists,
  tableExists,
} = require('../migrations-helper');

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (desc && desc[columnName]) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

async function dropColumnIfExists(queryInterface, tableName, columnName) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (!desc || !desc[columnName]) return;
  await queryInterface.removeColumn(tableName, columnName).catch(() => {});
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'ura_decision_audits', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      ticket_id: { type: Sequelize.STRING(128), allowNull: true },
      message_id: { type: Sequelize.STRING(191), allowNull: true },
      intent: { type: Sequelize.STRING(120), allowNull: true },
      secondary_intent: { type: Sequelize.STRING(120), allowNull: true },
      confidence: { type: Sequelize.DECIMAL(7, 4), allowNull: true },
      fallback_used: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      department_id: { type: Sequelize.STRING(128), allowNull: true },
      queue_name: { type: Sequelize.STRING(191), allowNull: true },
      rag_used: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      provider_status: { type: Sequelize.STRING(40), allowNull: true },
      latency_ms: { type: Sequelize.INTEGER, allowNull: true },
      context_used_summary_json: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'ura_decision_audits', ['tenant_key', 'created_at'], { name: 'ura_audit_tenant_created_idx' });
    await addIndexIfNotExists(queryInterface, 'ura_decision_audits', ['tenant_key', 'ticket_id'], { name: 'ura_audit_tenant_ticket_idx' });
    await addIndexIfNotExists(queryInterface, 'ura_decision_audits', ['tenant_key', 'provider_status'], { name: 'ura_audit_tenant_provider_idx' });
    await addIndexIfNotExists(queryInterface, 'ura_decision_audits', ['tenant_key', 'department_id'], { name: 'ura_audit_tenant_department_idx' });

    await createTableIfNotExists(queryInterface, 'operational_alerts', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      alert_type: { type: Sequelize.STRING(80), allowNull: false },
      severity: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
      entity_type: { type: Sequelize.STRING(80), allowNull: false },
      entity_id: { type: Sequelize.STRING(191), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: false },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'operational_alerts', ['tenant_key', 'created_at'], { name: 'oper_alerts_tenant_created_idx' });
    await addIndexIfNotExists(queryInterface, 'operational_alerts', ['tenant_key', 'resolved_at'], { name: 'oper_alerts_tenant_resolved_idx' });
    await addIndexIfNotExists(queryInterface, 'operational_alerts', ['tenant_key', 'alert_type', 'entity_type', 'entity_id'], { name: 'oper_alerts_tenant_type_entity_idx' });

    await createTableIfNotExists(queryInterface, 'tenant_feature_flags', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      feature_key: { type: Sequelize.STRING(120), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      config_json: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'tenant_feature_flags', ['tenant_key', 'feature_key'], {
      name: 'tenant_feature_flags_tenant_feature_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'tenant_feature_flags', ['tenant_key', 'enabled'], {
      name: 'tenant_feature_flags_tenant_enabled_idx',
    });

    if (await tableExists(queryInterface, 'operational_metric_snapshots')) {
      await ensureColumn(queryInterface, 'operational_metric_snapshots', 'metric_scope', {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'autonomous',
      });
      await ensureColumn(queryInterface, 'operational_metric_snapshots', 'snapshot_payload_json', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
      await addIndexIfNotExists(queryInterface, 'operational_metric_snapshots', ['tenant_key', 'metric_scope', 'snapshot_date'], {
        name: 'oper_metric_snapshots_tenant_scope_date_idx',
      });
    }
  },

  async down(queryInterface) {
    await dropColumnIfExists(queryInterface, 'operational_metric_snapshots', 'snapshot_payload_json');
    await dropColumnIfExists(queryInterface, 'operational_metric_snapshots', 'metric_scope');
    await queryInterface.dropTable('tenant_feature_flags').catch(() => {});
    await queryInterface.dropTable('operational_alerts').catch(() => {});
    await queryInterface.dropTable('ura_decision_audits').catch(() => {});
  },
};

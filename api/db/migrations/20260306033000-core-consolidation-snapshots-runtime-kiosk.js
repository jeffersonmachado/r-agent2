'use strict';

const { createTableIfNotExists, addIndexIfNotExists, tableExists } = require('../migrations-helper');

async function describeTableSafe(queryInterface, tableName) {
  try {
    return await queryInterface.describeTable(tableName);
  } catch (_) {
    return null;
  }
}

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  try {
    const columns = await describeTableSafe(queryInterface, tableName);
    if (columns && columns[columnName]) return;
    await queryInterface.addColumn(tableName, columnName, definition);
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('already exists')) return;
    throw err;
  }
}

async function ensureTenantKeyCompatibility(queryInterface, Sequelize, tableName) {
  const columns = await describeTableSafe(queryInterface, tableName);
  if (!columns) return 'tenant_key';
  if (columns.tenant_key) return 'tenant_key';
  if (!columns.tenant_id) return null;

  await ensureColumn(queryInterface, tableName, 'tenant_key', {
    type: Sequelize.STRING(100),
    allowNull: true,
  });

  try {
    await queryInterface.sequelize.query(`
      UPDATE ${tableName}
      SET tenant_key = CAST(tenant_id AS VARCHAR(100))
      WHERE tenant_key IS NULL AND tenant_id IS NOT NULL
    `);
  } catch (_) {
    // best-effort: ambientes sem tenant_id populado continuam com tenant_key nullable
  }

  return 'tenant_key';
}

async function addTenantIndexIfPossible(queryInterface, tableName, fields, options = {}) {
  const columns = await describeTableSafe(queryInterface, tableName);
  if (!columns) return;
  const validFields = fields.filter((field) => !!columns[field]);
  if (validFields.length !== fields.length) return;
  await addIndexIfNotExists(queryInterface, tableName, validFields, options);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'operational_metric_snapshots', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      vertical_template: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'beauty' },
      service_type: { type: Sequelize.STRING(100), allowNull: true },
      owner_id: { type: Sequelize.STRING(128), allowNull: true },
      team_id: { type: Sequelize.STRING(128), allowNull: true },
      day_of_week: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      hour_bucket: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      snapshot_date: { type: Sequelize.DATEONLY, allowNull: false },
      open_campaigns: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      filled_campaigns: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      accepted_candidates: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      expired_campaigns: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      fill_rate: { type: Sequelize.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
      accept_rate: { type: Sequelize.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
      avg_fill_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      idle_risk_score: { type: Sequelize.DECIMAL(7, 4), allowNull: true },
      no_show_risk_score: { type: Sequelize.DECIMAL(7, 4), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await ensureTenantKeyCompatibility(queryInterface, Sequelize, 'operational_metric_snapshots');
    await addTenantIndexIfPossible(queryInterface, 'operational_metric_snapshots', ['tenant_key', 'snapshot_date'], {
      name: 'oper_metric_snapshots_tenant_date_idx',
    });
    await addTenantIndexIfPossible(queryInterface, 'operational_metric_snapshots', ['tenant_key', 'vertical_template', 'service_type'], {
      name: 'oper_metric_snapshots_tenant_vertical_service_idx',
    });
    await addTenantIndexIfPossible(queryInterface, 'operational_metric_snapshots', ['tenant_key', 'snapshot_date', 'vertical_template', 'service_type', 'owner_id', 'team_id', 'day_of_week', 'hour_bucket'], {
      unique: true,
      name: 'oper_metric_snapshots_dedupe_idx',
    });

    if (await tableExists(queryInterface, 'autonomous_runtime')) {
      await ensureTenantKeyCompatibility(queryInterface, Sequelize, 'autonomous_runtime');
      await ensureColumn(queryInterface, 'autonomous_runtime', 'predictive_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'revenue_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'kiosk_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'snapshot_generation_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'recommendations_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'simulation_mode', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'max_recommendations_per_run', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'max_snapshots_per_day', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 8 });
      await ensureColumn(queryInterface, 'autonomous_runtime', 'runtime_notes', { type: Sequelize.TEXT, allowNull: true });
    }

    if (await tableExists(queryInterface, 'kiosk_sessions')) {
      await ensureTenantKeyCompatibility(queryInterface, Sequelize, 'kiosk_sessions');
      await ensureColumn(queryInterface, 'kiosk_sessions', 'status_reason', { type: Sequelize.STRING(120), allowNull: true });
      await ensureColumn(queryInterface, 'kiosk_sessions', 'checkin_at', { type: Sequelize.DATE, allowNull: true });
      await ensureColumn(queryInterface, 'kiosk_sessions', 'closed_at', { type: Sequelize.DATE, allowNull: true });
      await ensureColumn(queryInterface, 'kiosk_sessions', 'context_payload', { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' });
      await addTenantIndexIfPossible(queryInterface, 'kiosk_sessions', ['tenant_key', 'status'], {
        name: 'kiosk_sessions_tenant_status_idx',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('operational_metric_snapshots');
  },
};

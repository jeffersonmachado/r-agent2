'use strict';

const { addIndexIfNotExists, tableExists } = require('../migrations-helper');

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (desc && desc[columnName]) return;
  await queryInterface.addColumn(tableName, columnName, definition);
}

async function ensureTenantKeyCompatibility(queryInterface, Sequelize, tableName) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (!desc || typeof desc !== 'object') return null;
  if (desc.tenant_key) return 'tenant_key';
  if (!desc.tenant_id) return null;

  await ensureColumn(queryInterface, tableName, 'tenant_key', {
    type: Sequelize.STRING(100),
    allowNull: true,
  });

  await queryInterface.sequelize.query(`
    UPDATE ${tableName}
    SET tenant_key = CAST(tenant_id AS VARCHAR(100))
    WHERE tenant_key IS NULL AND tenant_id IS NOT NULL
  `).catch(() => {});

  return 'tenant_key';
}

async function addIndexIfColumnsExist(queryInterface, tableName, fields, options) {
  const desc = await queryInterface.describeTable(tableName).catch(() => ({}));
  if (!desc || typeof desc !== 'object') return;
  const allExist = fields.every((field) => !!desc[field]);
  if (!allExist) return;
  await addIndexIfNotExists(queryInterface, tableName, fields, options);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'operational_metric_snapshots')) {
      const tenantColumn = await ensureTenantKeyCompatibility(queryInterface, Sequelize, 'operational_metric_snapshots');
      await ensureColumn(queryInterface, 'operational_metric_snapshots', 'metric_scope', {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'autonomous',
      });
      await ensureColumn(queryInterface, 'operational_metric_snapshots', 'snapshot_payload_json', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
      if (tenantColumn) {
        await addIndexIfColumnsExist(queryInterface, 'operational_metric_snapshots', [tenantColumn, 'metric_scope', 'snapshot_date'], {
          name: 'oper_metric_snapshots_tenant_scope_date_idx',
        });
      }
    }

    if (await tableExists(queryInterface, 'revenue_opportunities')) {
      const tenantColumn = await ensureTenantKeyCompatibility(queryInterface, Sequelize, 'revenue_opportunities');
      await ensureColumn(queryInterface, 'revenue_opportunities', 'source_engine', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
      await ensureColumn(queryInterface, 'revenue_opportunities', 'vertical_template', {
        type: Sequelize.STRING(50),
        allowNull: true,
      });
      await ensureColumn(queryInterface, 'revenue_opportunities', 'related_entity_type', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
      await ensureColumn(queryInterface, 'revenue_opportunities', 'related_entity_id', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
      if (tenantColumn) {
        await addIndexIfColumnsExist(queryInterface, 'revenue_opportunities', [tenantColumn, 'related_entity_type', 'related_entity_id'], {
          name: 'revenue_opportunities_related_entity_idx',
        });
      }
    }

    if (await tableExists(queryInterface, 'autonomous_runtime')) {
      await ensureColumn(queryInterface, 'autonomous_runtime', 'metrics_window_days', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const snapshotDesc = await queryInterface.describeTable('operational_metric_snapshots').catch(() => ({}));
    if (snapshotDesc && snapshotDesc.metric_scope) {
      await queryInterface.removeColumn('operational_metric_snapshots', 'metric_scope').catch(() => {});
    }
    if (snapshotDesc && snapshotDesc.snapshot_payload_json) {
      await queryInterface.removeColumn('operational_metric_snapshots', 'snapshot_payload_json').catch(() => {});
    }

    const revenueDesc = await queryInterface.describeTable('revenue_opportunities').catch(() => ({}));
    for (const columnName of ['source_engine', 'vertical_template', 'related_entity_type', 'related_entity_id']) {
      if (revenueDesc && revenueDesc[columnName]) {
        await queryInterface.removeColumn('revenue_opportunities', columnName).catch(() => {});
      }
    }

    const runtimeDesc = await queryInterface.describeTable('autonomous_runtime').catch(() => ({}));
    if (runtimeDesc && runtimeDesc.metrics_window_days) {
      await queryInterface.removeColumn('autonomous_runtime', 'metrics_window_days').catch(() => {});
    }
  },
};

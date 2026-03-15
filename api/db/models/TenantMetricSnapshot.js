/**
 * Model TenantMetricSnapshot - tenant_metric_snapshots (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TenantMetricSnapshot = null;

function getTenantMetricSnapshotModel() {
  if (!TenantMetricSnapshot) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    TenantMetricSnapshot = sequelize.define('TenantMetricSnapshot', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      metric_key: { type: DataTypes.STRING(120), allowNull: false },
      value: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
      period_start: { type: DataTypes.DATE, allowNull: false },
      period_end: { type: DataTypes.DATE, allowNull: false },
      dimensions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      source: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'event_ledger' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'tenant_metric_snapshots',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key'], name: 'tenant_metric_snapshots_tenant_key_idx' },
        { fields: ['tenant_key', 'metric_key', 'period_start'], name: 'tenant_metric_snapshots_tenant_metric_period_start_idx' },
        { fields: ['tenant_key', 'period_start', 'period_end'], name: 'tenant_metric_snapshots_tenant_period_idx' },
      ],
    });
  }

  return TenantMetricSnapshot;
}

module.exports = getTenantMetricSnapshotModel;

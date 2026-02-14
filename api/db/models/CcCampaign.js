const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('CcCampaign', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(255), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'draft' },
  startAt: { type: DataTypes.DATE, allowNull: true, field: 'start_at' },
  endAt: { type: DataTypes.DATE, allowNull: true, field: 'end_at' },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  click2callEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'click2call_enabled' },
  recordEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'record_enabled' },
}, {
  tableName: 'cc_campaigns',
  timestamps: true,
});


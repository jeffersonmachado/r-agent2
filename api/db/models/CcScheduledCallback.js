const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('CcScheduledCallback', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  scheduledAt: { type: DataTypes.DATE, allowNull: false, field: 'scheduled_at' },
  description: { type: DataTypes.STRING(255), allowNull: true },
  ddd: { type: DataTypes.STRING(8), allowNull: true },
  phone: { type: DataTypes.STRING(40), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'cc_scheduled_callbacks',
  timestamps: true,
});


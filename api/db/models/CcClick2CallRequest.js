const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('CcClick2CallRequest', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  campaignId: { type: DataTypes.STRING, allowNull: true, field: 'campaign_id' },
  target: { type: DataTypes.STRING(128), allowNull: false },
  ddd: { type: DataTypes.STRING(8), allowNull: true },
  phone: { type: DataTypes.STRING(40), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' },
  extra: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'cc_click2call_requests',
  timestamps: true,
});


const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('CcCampaignListItem', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  campaignId: { type: DataTypes.STRING, allowNull: false, field: 'campaign_id' },
  ddd: { type: DataTypes.STRING(8), allowNull: true },
  phone: { type: DataTypes.STRING(40), allowNull: false },
  key: { type: DataTypes.STRING(80), allowNull: true },
  status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'pending' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  extra: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'cc_campaign_list',
  timestamps: true,
});


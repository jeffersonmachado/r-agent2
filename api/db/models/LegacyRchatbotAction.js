const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyRchatbotAction', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  rchatbotId: { type: DataTypes.STRING, allowNull: false, field: 'rchatbot_id' },
  action: { type: DataTypes.STRING(128), allowNull: false },
  extra: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'legacy_rchatbot_actions',
  timestamps: true,
});


const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyRchatbot', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  tag: { type: DataTypes.STRING(128), allowNull: false },
  contextSet: { type: DataTypes.TEXT, allowNull: true, field: 'context_set' },
  contextFilter: { type: DataTypes.TEXT, allowNull: true, field: 'context_filter' },
}, {
  tableName: 'legacy_rchatbot',
  timestamps: true,
});


const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyRchatbotPattern', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  rchatbotId: { type: DataTypes.STRING, allowNull: false, field: 'rchatbot_id' },
  patterns: { type: DataTypes.TEXT, allowNull: false },
}, {
  tableName: 'legacy_rchatbot_patterns',
  timestamps: true,
});


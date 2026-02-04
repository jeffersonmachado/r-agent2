const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('LegacyRchatbotResponse', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  rchatbotId: { type: DataTypes.STRING, allowNull: false, field: 'rchatbot_id' },
  responses: { type: DataTypes.TEXT, allowNull: false },
}, {
  tableName: 'legacy_rchatbot_responses',
  timestamps: true,
});

